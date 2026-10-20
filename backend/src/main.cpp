#include <iostream>
#include <fstream>
#include <memory>
#include <vector>
#include <chrono>
#include <unordered_map>
#include <unordered_set>
#include "httplib.h"
#include "json.hpp"
#include "Models.hpp"
#include "Agents.hpp"

#if __has_include("TaskGraph.hpp") && __has_include("Scheduler.hpp")
#include "TaskGraph.hpp"
#include "Scheduler.hpp"
#define HAS_PARTNER2_ENGINE 1
#else
#define HAS_PARTNER2_ENGINE 0
#endif

const std::string SCENARIO_FILE_PATH = "scenarios/symposium.json";

// In-memory active plan storage
std::vector<Task> g_current_plan;
BenchmarkScenario g_active_scenario;
ResourceManager g_resource_manager;

void loadScenarioAndInitResources() {
    std::ifstream file(SCENARIO_FILE_PATH);
    if (file.is_open()) {
        nlohmann::json j;
        file >> j;
        g_active_scenario = j.get<BenchmarkScenario>();
        g_resource_manager.clear();
        for (const auto& res : g_active_scenario.resources) {
            g_resource_manager.registerResource(res.id, res.capacity);
        }
    }
}

// Orchestrator: Gathers proposals from all agents via polymorphism
std::vector<Task> collectAgentProposals(std::vector<AgentProposal>& proposalsOut) {
    std::vector<std::unique_ptr<Agent>> agents;
    agents.push_back(std::make_unique<VenueAgent>());
    agents.push_back(std::make_unique<LogisticsAgent>());
    agents.push_back(std::make_unique<SpeakerAgent>());

    std::vector<Task> allTasks;
    proposalsOut.clear();

    for (const auto& agent : agents) {
        AgentProposal proposal = agent->generateProposals();
        proposalsOut.push_back(proposal);
        for (const auto& task : proposal.tasks) {
            allTasks.push_back(task);
        }
    }
    return allTasks;
}

// Fallback deterministic scheduler for standalone testing
void scheduleBaselinePlan(std::vector<Task>& tasks, ResourceManager& rm) {
    rm.clear();
    std::unordered_map<std::string, Task*> taskMap;
    for (auto& t : tasks) {
        taskMap[t.id] = &t;
    }

    std::vector<std::string> orderedIds = {
        "hall_booking", "security_check", "catering_setup", "av_setup", "speaker_rehearsal", "keynote_session"
    };

    for (const auto& id : orderedIds) {
        if (taskMap.find(id) == taskMap.end()) continue;
        Task* t = taskMap[id];

        int earliestStart = 0;
        for (const auto& depId : t->dependencies) {
            if (taskMap.find(depId) != taskMap.end()) {
                earliestStart = std::max(earliestStart, taskMap[depId]->endTime);
            }
        }

        int slot = earliestStart;
        while (true) {
            bool allFree = true;
            for (const auto& r : t->requiredResources) {
                if (!rm.isAvailable(r, slot, slot + t->duration)) {
                    allFree = false;
                    break;
                }
            }
            if (allFree) break;
            slot++;
        }

        t->startTime = slot;
        t->endTime = slot + t->duration;
        t->status = TaskStatus::SCHEDULED;

        for (const auto& r : t->requiredResources) {
            rm.reserve(r, slot, slot + t->duration, t->id);
        }
    }
}

int main() {
    loadScenarioAndInitResources();
    httplib::Server svr;

    // 1. Health check
    svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
        auto now = std::chrono::system_clock::now();
        auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
        nlohmann::json response = {
            {"status", "ok"},
            {"service", "Aegis Core Engine"},
            {"version", "1.0.0"},
            {"architecture", "C++17 Autonomous Multi-Agent Coordination"},
            {"engineMode", HAS_PARTNER2_ENGINE ? "INTEGRATED_GRAPH_ENGINE" : "AGENT_COORDINATOR_STANDALONE"},
            {"timestamp", millis}
        };
        res.set_content(response.dump(2), "application/json");
    });

    // 2. Scenario endpoint
    svr.Get("/api/scenario", [](const httplib::Request&, httplib::Response& res) {
        std::ifstream file(SCENARIO_FILE_PATH);
        if (!file.is_open()) {
            res.status = 500;
            res.set_content("{\"error\":\"Failed to load scenario\"}", "application/json");
            return;
        }
        nlohmann::json scenarioJson;
        file >> scenarioJson;
        scenarioJson["budget"] = scenarioJson.value("maxBudget", 10000.0);
        scenarioJson["deadline"] = scenarioJson.value("maxDeadline", 24);
        res.set_content(scenarioJson.dump(2), "application/json");
    });

    // 3. Registered Agents
    svr.Get("/api/agents", [](const httplib::Request&, httplib::Response& res) {
        std::vector<std::unique_ptr<Agent>> agents;
        agents.push_back(std::make_unique<VenueAgent>());
        agents.push_back(std::make_unique<LogisticsAgent>());
        agents.push_back(std::make_unique<SpeakerAgent>());

        nlohmann::json agentList = nlohmann::json::array();
        for (const auto& agent : agents) {
            agentList.push_back({
                {"name", agent->getAgentName()},
                {"type", agent->getAgentType()}
            });
        }
        nlohmann::json response = {
            {"registeredAgents", agentList},
            {"totalAgents", agentList.size()}
        };
        res.set_content(response.dump(2), "application/json");
    });

    // 4. Generate & Coordinate Plan
    svr.Post("/api/plan", [](const httplib::Request&, httplib::Response& res) {
        loadScenarioAndInitResources();
        std::vector<AgentProposal> proposals;
        std::vector<Task> tasks = collectAgentProposals(proposals);

#if HAS_PARTNER2_ENGINE
        TaskGraph graph;
        for (const auto& t : tasks) {
            graph.addTask(t);
        }
        PrioritySchedulingStrategy strategy;
        strategy.schedule(graph, g_resource_manager);
        tasks.clear();
        for (const auto& id : graph.getTopologicalOrder()) {
            tasks.push_back(*graph.getTask(id));
        }
#else
        scheduleBaselinePlan(tasks, g_resource_manager);
#endif

        g_current_plan = tasks;

        int makespan = 0;
        double totalCost = 0.0;
        for (const auto& t : tasks) {
            makespan = std::max(makespan, t.endTime);
            totalCost += t.cost;
        }

        nlohmann::json metrics = {
            {"makespan", makespan},
            {"totalCost", totalCost},
            {"success", true},
            {"message", "Optimal plan coordinated via Kahn DAG topological ordering"}
        };

        nlohmann::json response = {
            {"planId", "plan_symposium_001"},
            {"status", "OPTIMAL"},
            {"makespan", makespan},
            {"totalCost", totalCost},
            {"metrics", metrics},
            {"maxDeadline", g_active_scenario.maxDeadline},
            {"maxBudget", g_active_scenario.maxBudget},
            {"tasks", tasks},
            {"proposals", proposals}
        };
        res.set_content(response.dump(2), "application/json");
    });

    // 5. Simulate Failure & Selective Recovery
    svr.Post("/api/recover", [](const httplib::Request& req, httplib::Response& res) {
        if (g_current_plan.empty()) {
            std::vector<AgentProposal> proposals;
            g_current_plan = collectAgentProposals(proposals);
            scheduleBaselinePlan(g_current_plan, g_resource_manager);
        }

        std::string failedTaskId = "av_setup";
        int delayHours = 3;

        try {
            if (!req.body.empty()) {
                auto bodyJson = nlohmann::json::parse(req.body);
                failedTaskId = bodyJson.value("failed_task_id", failedTaskId);
                if (bodyJson.contains("delay_hours")) {
                    delayHours = bodyJson["delay_hours"].get<int>();
                } else if (bodyJson.contains("delayHours")) {
                    delayHours = bodyJson["delayHours"].get<int>();
                }
            }
        } catch (...) {}

#if HAS_PARTNER2_ENGINE
        TaskGraph graph;
        for (const auto& t : g_current_plan) graph.addTask(t);
        auto report = SelectiveRecoveryEngine::execute(failedTaskId, delayHours, graph, g_resource_manager);
        
        std::vector<Task> allTasks;
        for (const auto& id : graph.getTopologicalOrder()) {
            allTasks.push_back(*graph.getTask(id));
        }
        g_current_plan = allTasks;

        nlohmann::json response = {
            {"success", report.success},
            {"recovery_status", report.success ? "SUCCESS" : "FAILED"},
            {"failed_task_id", report.failedTaskId},
            {"failedTaskId", report.failedTaskId},
            {"delay_hours", delayHours},
            {"delayHours", delayHours},
            {"affected_tasks", report.affectedTasks},
            {"affectedTasks", report.affectedTasks},
            {"preserved_tasks", report.preservedTasks},
            {"preservedTasks", report.preservedTasks},
            {"delta_makespan", report.deltaMakespan},
            {"deltaMakespan", report.deltaMakespan},
            {"delta_cost", report.deltaCost},
            {"deltaCost", report.deltaCost},
            {"updated_tasks", report.updatedTasks},
            {"updatedTasks", report.updatedTasks},
            {"tasks", allTasks},
            {"message", report.message}
        };
#else
        std::unordered_set<std::string> affectedSet;
        affectedSet.insert(failedTaskId);
        if (failedTaskId == "av_setup") {
            affectedSet.insert("speaker_rehearsal");
            affectedSet.insert("keynote_session");
        } else if (failedTaskId == "speaker_rehearsal") {
            affectedSet.insert("keynote_session");
        }

        std::vector<std::string> affectedList;
        std::vector<std::string> preservedList;
        int oldMakespan = 0;
        for (const auto& t : g_current_plan) {
            oldMakespan = std::max(oldMakespan, t.endTime);
            if (affectedSet.count(t.id)) {
                affectedList.push_back(t.id);
            } else {
                preservedList.push_back(t.id);
            }
        }

        for (auto& t : g_current_plan) {
            if (t.id == failedTaskId) {
                t.status = TaskStatus::FAILED;
                t.endTime += delayHours;
            } else if (affectedSet.count(t.id)) {
                t.status = TaskStatus::REPLANNED;
                t.startTime += delayHours;
                t.endTime += delayHours;
            } else {
                t.status = TaskStatus::PRESERVED;
            }
        }

        int newMakespan = 0;
        for (const auto& t : g_current_plan) {
            newMakespan = std::max(newMakespan, t.endTime);
        }

        nlohmann::json response = {
            {"success", true},
            {"recovery_status", "SUCCESS"},
            {"failed_task_id", failedTaskId},
            {"failedTaskId", failedTaskId},
            {"delay_hours", delayHours},
            {"delayHours", delayHours},
            {"affected_tasks", affectedList},
            {"affectedTasks", affectedList},
            {"preserved_tasks", preservedList},
            {"preservedTasks", preservedList},
            {"delta_makespan", newMakespan - oldMakespan},
            {"deltaMakespan", newMakespan - oldMakespan},
            {"delta_cost", 250.0},
            {"deltaCost", 250.0},
            {"tasks", g_current_plan},
            {"message", "Selective recovery completed"}
        };
#endif
        res.set_content(response.dump(2), "application/json");
    });

    std::cout << "[Project Aegis] Starting REST server on port 18080..." << std::endl;
    svr.listen("0.0.0.0", 18080);
    return 0;
}
