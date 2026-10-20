#pragma once

#include "Models.hpp"
#include "TaskGraph.hpp"

#include <algorithm>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

// ============================================================================
// Scheduling abstraction
// ============================================================================

struct ScheduleMetrics {
    int makespan = 0;
    double totalCost = 0.0;
    bool success = false;
    std::string message;
};

class ISchedulingStrategy {
public:
    virtual ~ISchedulingStrategy() = default;
    virtual ScheduleMetrics schedule(TaskGraph& graph, ResourceManager& resMgr) = 0;
};

// Shared helpers used by both the strategy and the recovery engine.
namespace scheduling_detail {

constexpr int kSearchHorizon = 1000;  // hours to scan before giving up on a slot

// earliestStart = max(parent.endTime), default 0.
inline int earliestStart(const TaskGraph& graph, const Task& task) {
    int earliest = 0;
    for (const std::string& parentId : task.dependencies) {
        const Task* parent = graph.getTask(parentId);
        if (parent && parent->endTime > earliest) earliest = parent->endTime;
    }
    return earliest;
}

// First t >= from such that [t, t + duration) is free on every resource, or -1.
inline int findSlot(const ResourceManager& resMgr, const std::vector<std::string>& resources,
                    int duration, int from) {
    for (int t = from; t < from + kSearchHorizon; ++t) {
        bool free = true;
        for (const std::string& res : resources) {
            if (!resMgr.isAvailable(res, t, t + duration)) {
                free = false;
                break;
            }
        }
        if (free) return t;
    }
    return -1;
}

// Reserves [start, end) on all resources atomically (rolls back on failure).
inline bool commitSlot(ResourceManager& resMgr, const std::vector<std::string>& resources,
                       const std::string& taskId, int start, int end) {
    std::vector<std::string> done;
    for (const std::string& res : resources) {
        if (!resMgr.reserve(res, start, end, taskId)) {
            for (const std::string& d : done) resMgr.release(d, taskId);
            return false;
        }
        done.push_back(res);
    }
    return true;
}

inline int makespanOf(const TaskGraph& graph) {
    int makespan = 0;
    for (const auto& kv : graph.getAllTasks()) {
        if (kv.second.isScheduled()) makespan = std::max(makespan, kv.second.endTime);
    }
    return makespan;
}

inline double totalCostOf(const TaskGraph& graph) {
    double total = 0.0;
    for (const auto& kv : graph.getAllTasks()) total += kv.second.cost;
    return total;
}

}  // namespace scheduling_detail

// ============================================================================
// Concrete strategy: topological order (priority breaks ties), earliest slot
// ============================================================================

class PrioritySchedulingStrategy : public ISchedulingStrategy {
public:
    ScheduleMetrics schedule(TaskGraph& graph, ResourceManager& resMgr) override {
        using namespace scheduling_detail;
        ScheduleMetrics metrics;

        std::vector<std::string> order;
        try {
            order = graph.getTopologicalOrder();
        } catch (const std::runtime_error& e) {
            metrics.message = e.what();
            return metrics;
        }

        // Idempotent: drop any reservations left from a previous run.
        for (const auto& kv : graph.getAllTasks()) {
            for (const std::string& res : kv.second.requiredResources) {
                resMgr.release(res, kv.first);
            }
        }

        for (const std::string& id : order) {
            Task* task = graph.getTask(id);
            const int from = earliestStart(graph, *task);
            const int start = findSlot(resMgr, task->requiredResources, task->duration, from);
            const int end = start + task->duration;

            if (start < 0 || !commitSlot(resMgr, task->requiredResources, id, start, end)) {
                metrics.message = "No feasible slot found for task '" + id + "'";
                return metrics;
            }
            task->startTime = start;
            task->endTime = end;
            task->status = TaskStatus::SCHEDULED;
        }

        metrics.makespan = makespanOf(graph);
        metrics.totalCost = totalCostOf(graph);
        metrics.success = true;
        metrics.message = "Scheduled " + std::to_string(order.size()) + " tasks, makespan " +
                          std::to_string(metrics.makespan) + "h";
        return metrics;
    }
};

// ============================================================================
// Selective recovery: only the failed task's downstream subgraph is replanned
// ============================================================================

struct RecoveryReport {
    bool success = false;
    std::string failedTaskId;
    std::vector<std::string> affectedTasks;   // downstream tasks that were replanned (failed task excluded)
    std::vector<std::string> preservedTasks;  // scheduled tasks left frozen
    int deltaMakespan = 0;
    double deltaCost = 0.0;
    std::vector<Task> updatedTasks;           // failed task + every task whose slot was recomputed
    std::string message;
};

class SelectiveRecoveryEngine {
public:
    // Re-booking fee charged on the failed task and on every replanned task.
    static constexpr double kRescheduleFeeRate = 0.10;

    static RecoveryReport execute(const std::string& failedTaskId, int delayHours,
                                  TaskGraph& graph, ResourceManager& resMgr) {
        using namespace scheduling_detail;

        RecoveryReport report;
        report.failedTaskId = failedTaskId;

        Task* failed = graph.getTask(failedTaskId);
        if (!failed) {
            report.message = "Unknown task: " + failedTaskId;
            return report;
        }
        if (delayHours < 0) {
            report.message = "delayHours must be >= 0";
            return report;
        }
        if (!failed->isScheduled()) {
            report.message = "Task '" + failedTaskId + "' has not been scheduled yet";
            return report;
        }

        std::vector<std::string> order;
        try {
            order = graph.getTopologicalOrder();
        } catch (const std::runtime_error& e) {
            report.message = e.what();
            return report;
        }

        const int oldMakespan = makespanOf(graph);

        // 1. Affected set = failed task + everything reachable downstream (BFS).
        const std::unordered_set<std::string> affected = graph.getDownstreamSubgraph(failedTaskId);

        // 2 + 3. Freeze everything else; release reservations of the affected set.
        std::unordered_map<std::string, std::pair<int, int>> oldSlots;
        for (const std::string& id : order) {
            Task* task = graph.getTask(id);
            if (affected.count(id)) {
                oldSlots[id] = {task->startTime, task->endTime};
                for (const std::string& res : task->requiredResources) resMgr.release(res, id);
                if (id != failedTaskId) report.affectedTasks.push_back(id);
            } else if (task->isScheduled()) {
                task->status = TaskStatus::PRESERVED;  // slot + reservations untouched
                report.preservedTasks.push_back(id);
            }
        }

        // 4. The failed task now finishes at oldEnd + delay. It keeps its start
        //    and holds its resources for the longer window. If a frozen task
        //    already occupies part of that window, slide the window later.
        const int oldStart = oldSlots[failedTaskId].first;
        const int oldEnd = oldSlots[failedTaskId].second;
        const int span = (oldEnd + delayHours) - oldStart;

        int failedStart = oldStart;
        if (!commitSlot(resMgr, failed->requiredResources, failedTaskId, oldStart, oldStart + span)) {
            failedStart = findSlot(resMgr, failed->requiredResources, span, oldStart);
            if (failedStart < 0 ||
                !commitSlot(resMgr, failed->requiredResources, failedTaskId, failedStart,
                            failedStart + span)) {
                report.message = "Could not hold resources for delayed task '" + failedTaskId + "'";
                return report;
            }
        }
        failed->startTime = failedStart;
        failed->endTime = failedStart + span;
        failed->status = TaskStatus::FAILED;
        report.updatedTasks.push_back(*failed);

        // 5 + 6. Reschedule the downstream tasks in topological order.
        double replannedCost = failed->cost;
        for (const std::string& id : order) {
            if (id == failedTaskId || !affected.count(id)) continue;

            Task* task = graph.getTask(id);
            const int from = earliestStart(graph, *task);
            const int start = findSlot(resMgr, task->requiredResources, task->duration, from);
            const int end = start + task->duration;
            if (start < 0 || !commitSlot(resMgr, task->requiredResources, id, start, end)) {
                report.message = "No feasible slot found for downstream task '" + id + "'";
                return report;
            }

            const bool moved = (start != oldSlots[id].first) || (end != oldSlots[id].second);
            task->startTime = start;
            task->endTime = end;
            task->status = moved ? TaskStatus::REPLANNED : TaskStatus::SCHEDULED;
            if (moved) replannedCost += task->cost;
            report.updatedTasks.push_back(*task);
        }

        // 7. Deltas.
        report.deltaMakespan = makespanOf(graph) - oldMakespan;
        report.deltaCost = replannedCost * kRescheduleFeeRate;
        report.success = true;
        report.message = "Replanned " + std::to_string(report.affectedTasks.size()) +
                         " downstream tasks, preserved " +
                         std::to_string(report.preservedTasks.size());
        return report;
    }
};
