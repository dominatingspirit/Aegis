// Standalone check for TaskGraph + Scheduler + SelectiveRecoveryEngine.
//
// Before Partner 1's Models.hpp is merged:
//   g++ -std=c++17 -Wall -Wextra -I./backend/test/stub -I./backend/include test_recovery.cpp -o test_recovery
// After the merge (real Models.hpp in backend/include):
//   g++ -std=c++17 -Wall -Wextra -I./backend/include test_recovery.cpp -o test_recovery

#include "Scheduler.hpp"
#include "TaskGraph.hpp"

#include <algorithm>
#include <iostream>
#include <memory>
#include <string>

static int failures = 0;

#define CHECK(cond)                                                              \
    do {                                                                         \
        if (!(cond)) {                                                           \
            std::cerr << "  FAIL  line " << __LINE__ << ": " #cond << std::endl; \
            ++failures;                                                          \
        } else {                                                                 \
            std::cout << "  ok    " #cond << std::endl;                          \
        }                                                                        \
    } while (0)

static Task makeTask(const std::string& id, const std::string& agent, int duration, double cost,
                     int priority, std::vector<std::string> deps, std::vector<std::string> res) {
    Task t;
    t.id = id;
    t.name = id;
    t.agentType = agent;
    t.duration = duration;
    t.cost = cost;
    t.priority = priority;
    t.dependencies = std::move(deps);
    t.requiredResources = std::move(res);
    return t;
}

// The six-task symposium scenario from Partner 1's agents.
static void loadSymposium(TaskGraph& g, ResourceManager& r) {
    g.clear();
    r.clear();
    for (const char* res : {"main_hall", "tech_crew", "security_team", "catering_staff"}) {
        r.registerResource(res, 1);
    }
    g.addTask(makeTask("hall_booking", "VENUE", 4, 8000, 5, {}, {"main_hall"}));
    g.addTask(makeTask("security_check", "VENUE", 2, 2500, 4, {"hall_booking"}, {"security_team"}));
    g.addTask(makeTask("av_setup", "LOGISTICS", 3, 6000, 4, {"hall_booking"}, {"tech_crew"}));
    g.addTask(makeTask("catering_setup", "LOGISTICS", 2, 15000, 3, {"hall_booking"}, {"catering_staff"}));
    g.addTask(makeTask("speaker_rehearsal", "SPEAKER", 2, 2000, 3, {"av_setup"}, {"tech_crew"}));
    g.addTask(makeTask("keynote_session", "SPEAKER", 3, 12000, 5, {"speaker_rehearsal"}, {"main_hall"}));
}

int main() {
    TaskGraph graph;
    ResourceManager res;

    std::cout << "[1] TaskGraph: Kahn ordering and cycle detection\n";
    loadSymposium(graph, res);
    CHECK(!graph.hasCycle());
    auto order = graph.getTopologicalOrder();
    CHECK(order.size() == 6);
    auto pos = [&](const std::string& id) {
        return std::find(order.begin(), order.end(), id) - order.begin();
    };
    CHECK(pos("hall_booking") < pos("av_setup"));
    CHECK(pos("av_setup") < pos("speaker_rehearsal"));
    CHECK(pos("speaker_rehearsal") < pos("keynote_session"));

    auto down = graph.getDownstreamSubgraph("av_setup");
    CHECK(down.size() == 3);  // av_setup + speaker_rehearsal + keynote_session
    CHECK(down.count("av_setup") && down.count("speaker_rehearsal") && down.count("keynote_session"));
    CHECK(graph.getDownstreamSubgraph("nope").empty());

    TaskGraph cyc;
    cyc.addTask(makeTask("a", "VENUE", 1, 0, 1, {"b"}, {}));
    cyc.addTask(makeTask("b", "VENUE", 1, 0, 1, {"a"}, {}));
    CHECK(cyc.hasCycle());
    bool threw = false;
    try {
        cyc.getTopologicalOrder();
    } catch (const std::runtime_error&) {
        threw = true;
    }
    CHECK(threw);

    std::cout << "[2] PrioritySchedulingStrategy\n";
    std::unique_ptr<ISchedulingStrategy> strategy = std::make_unique<PrioritySchedulingStrategy>();
    ScheduleMetrics m = strategy->schedule(graph, res);
    CHECK(m.success);
    CHECK(m.makespan == 12);
    CHECK(m.totalCost == 45500.0);
    CHECK(graph.getTask("hall_booking")->startTime == 0 && graph.getTask("hall_booking")->endTime == 4);
    CHECK(graph.getTask("av_setup")->startTime == 4 && graph.getTask("av_setup")->endTime == 7);
    CHECK(graph.getTask("speaker_rehearsal")->startTime == 7);
    CHECK(graph.getTask("keynote_session")->startTime == 9 && graph.getTask("keynote_session")->endTime == 12);
    CHECK(graph.getTask("security_check")->status == TaskStatus::SCHEDULED);

    std::cout << "[3] SelectiveRecoveryEngine: av_setup fails, +3h\n";
    RecoveryReport rep = SelectiveRecoveryEngine::execute("av_setup", 3, graph, res);
    CHECK(rep.success);
    CHECK(rep.affectedTasks.size() == 2);   // speaker_rehearsal, keynote_session
    CHECK(rep.preservedTasks.size() == 3);  // hall_booking, security_check, catering_setup
    CHECK(graph.getTask("av_setup")->status == TaskStatus::FAILED);
    CHECK(graph.getTask("av_setup")->endTime == 10);
    CHECK(graph.getTask("speaker_rehearsal")->startTime == 10);
    CHECK(graph.getTask("keynote_session")->startTime == 12 && graph.getTask("keynote_session")->endTime == 15);
    CHECK(graph.getTask("speaker_rehearsal")->status == TaskStatus::REPLANNED);
    CHECK(graph.getTask("keynote_session")->status == TaskStatus::REPLANNED);
    CHECK(graph.getTask("hall_booking")->status == TaskStatus::PRESERVED);
    CHECK(graph.getTask("catering_setup")->startTime == 4);  // untouched
    CHECK(rep.deltaMakespan == 3);
    CHECK(rep.updatedTasks.size() == 3);
    CHECK(rep.deltaCost > 0.0);

    // Invariant: no two tasks overlap on the same (capacity-1) resource.
    bool overlap = false;
    const auto& all = graph.getAllTasks();
    for (const auto& a : all) {
        for (const auto& b : all) {
            if (a.first >= b.first) continue;
            for (const auto& ra : a.second.requiredResources) {
                for (const auto& rb : b.second.requiredResources) {
                    if (ra == rb && a.second.startTime < b.second.endTime &&
                        b.second.startTime < a.second.endTime) {
                        overlap = true;
                    }
                }
            }
        }
    }
    CHECK(!overlap);

    std::cout << "[4] Edge cases\n";
    CHECK(!SelectiveRecoveryEngine::execute("ghost", 2, graph, res).success);
    CHECK(!SelectiveRecoveryEngine::execute("hall_booking", -1, graph, res).success);

    // A leaf failing replans nothing downstream.
    loadSymposium(graph, res);
    strategy->schedule(graph, res);
    RecoveryReport leaf = SelectiveRecoveryEngine::execute("catering_setup", 2, graph, res);
    CHECK(leaf.success && leaf.affectedTasks.empty() && leaf.preservedTasks.size() == 5);
    CHECK(leaf.deltaMakespan == 0);  // catering ends at 8, keynote still ends at 12

    // The root failing replans everything else.
    loadSymposium(graph, res);
    strategy->schedule(graph, res);
    RecoveryReport root = SelectiveRecoveryEngine::execute("hall_booking", 2, graph, res);
    CHECK(root.success && root.affectedTasks.size() == 5 && root.preservedTasks.empty());

    std::cout << (failures == 0 ? "\nALL TESTS PASSED\n" : "\nSOME TESTS FAILED\n");
    return failures == 0 ? 0 : 1;
}
