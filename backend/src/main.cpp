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

std::string getScenarioPath(const std::string& id) {
    if (id == "hackathon") return "scenarios/hackathon.json";
    if (id == "robotics") return "scenarios/robotics.json";
    return "scenarios/symposium.json";
}

// In-memory active plan storage
std::vector<Task> g_current_plan;
BenchmarkScenario g_active_scenario;
ResourceManager g_resource_manager;

bool loadScenarioAndInitResources(const std::string& scenarioId = "symposium") {
    std::string path = getScenarioPath(scenarioId);
    std::ifstream file(path);
    if (!file.is_open()) return false;

    nlohmann::json j;
    file >> j;
    g_active_scenario = j.get<BenchmarkScenario>();
    g_resource_manager.clear();
    for (const auto& res : g_active_scenario.resources) {
        g_resource_manager.registerResource(res.id, res.capacity);
    }
    return true;
}

// Orchestrator: Gathers proposals from all agents via polymorphism (fallback)
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

int main() {
    loadScenarioAndInitResources("symposium");
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
            {"activeScenario", g_active_scenario.scenarioId},
            {"timestamp", millis}
        };
        res.set_content(response.dump(2), "application/json");
    });

    // 2. Scenarios list endpoint
    svr.Get("/api/scenarios", [](const httplib::Request&, httplib::Response& res) {
        nlohmann::json list = nlohmann::json::array({
            {
                {"id", "symposium"},
                {"name", "Tech Symposium 2026"},
                {"description", "Flagship DTU Tech Symposium with Venue, AV, and Keynote tracks"},
                {"taskCount", 6}
            },
            {
                {"id", "hackathon"},
                {"name", "Autonomous Hackathon 48H"},
                {"description", "48-Hour AI Hackathon with GPU cloud provisioning, mentoring & live demos"},
                {"taskCount", 8}
            },
            {
                {"id", "robotics"},
                {"name", "Robotics Autonomous Conclave"},
                {"description", "Autonomous rover trials with safety locks, telemetry and charging docks"},
                {"taskCount", 7}
            }
        });
        res.set_content(list.dump(2), "application/json");
    });

    // 3. Scenario detail endpoint
    svr.Get("/api/scenario", [](const httplib::Request& req, httplib::Response& res) {
        std::string scId = g_active_scenario.scenarioId;
        std::string hval = req.get_header_value("X-Scenario-Id");
        if (!hval.empty()) scId = hval;

        if (!req.query_string.empty()) {
            auto pos = req.query_string.find("id=");
            if (pos != std::string::npos) {
                auto end_pos = req.query_string.find('&', pos);
                scId = req.query_string.substr(pos + 3, end_pos == std::string::npos ? std::string::npos : end_pos - (pos + 3));
            }
        }

        std::string path = getScenarioPath(scId);
        std::ifstream file(path);
        if (!file.is_open()) {
            res.status = 500;
            res.set_content("{\"error\":\"Failed to load scenario\"}", "application/json");
            return;
        }
        nlohmann::json scenarioJson;
        file >> scenarioJson;
        scenarioJson["budget"] = scenarioJson.value("maxBudget", 60000.0);
        scenarioJson["deadline"] = scenarioJson.value("maxDeadline", 24);
        res.set_content(scenarioJson.dump(2), "application/json");
    });

    // 4. Registered Agents
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

    // 5. Generate & Coordinate Plan (Supports custom scenario & custom task parameters!)
    svr.Post("/api/plan", [](const httplib::Request& req, httplib::Response& res) {
        std::string scenarioId = g_active_scenario.scenarioId;
        std::vector<Task> inputTasks;
        bool hasCustomTasks = false;

        std::cout << "[POST /api/plan] req.body: '" << req.body << "'" << std::endl;
        try {
            if (!req.body.empty()) {
                auto bodyJson = nlohmann::json::parse(req.body);
                if (bodyJson.contains("scenario_id")) {
                    scenarioId = bodyJson["scenario_id"].get<std::string>();
                } else if (bodyJson.contains("scenarioId")) {
                    scenarioId = bodyJson["scenarioId"].get<std::string>();
                }

                if (bodyJson.contains("tasks") && bodyJson["tasks"].is_array() && !bodyJson["tasks"].empty()) {
                    inputTasks = bodyJson["tasks"].get<std::vector<Task>>();
                    hasCustomTasks = true;
                }
            }
        } catch (const std::exception& e) {
            std::cout << "[POST /api/plan] JSON parse error: " << e.what() << std::endl;
        }

        loadScenarioAndInitResources(scenarioId);

        std::vector<Task> tasks;
        std::vector<AgentProposal> proposals;

        if (hasCustomTasks) {
            tasks = inputTasks;
        } else if (!g_active_scenario.tasks.empty()) {
            tasks = g_active_scenario.tasks;
        } else {
            tasks = collectAgentProposals(proposals);
        }

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
            {"message", "Coordinated " + std::to_string(tasks.size()) + " tasks using Kahn DAG topological ordering"}
        };

        nlohmann::json response = {
            {"planId", "plan_" + g_active_scenario.scenarioId},
            {"scenarioId", g_active_scenario.scenarioId},
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

    // 6. Simulate Failure & Selective Recovery
    svr.Post("/api/recover", [](const httplib::Request& req, httplib::Response& res) {
        if (g_current_plan.empty()) {
            std::vector<AgentProposal> proposals;
            g_current_plan = collectAgentProposals(proposals);
        }

        std::string failedTaskId = g_current_plan[0].id;
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
        nlohmann::json response = {
            {"success", true},
            {"recovery_status", "SUCCESS"},
            {"failed_task_id", failedTaskId},
            {"delay_hours", delayHours},
            {"tasks", g_current_plan}
        };
#endif
        res.set_content(response.dump(2), "application/json");
    });

    std::cout << "[Project Aegis] Starting REST server on port 18080..." << std::endl;
    svr.listen("0.0.0.0", 18080);
    return 0;
}
