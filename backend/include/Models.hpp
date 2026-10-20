#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <algorithm>
#include <stdexcept>
#include "json.hpp"

// Task lifecycle statuses
enum class TaskStatus {
    PENDING,
    SCHEDULED,
    FAILED,
    REPLANNED,
    PRESERVED
};

inline std::string taskStatusToString(TaskStatus status) {
    switch (status) {
        case TaskStatus::PENDING:   return "PENDING";
        case TaskStatus::SCHEDULED: return "SCHEDULED";
        case TaskStatus::FAILED:    return "FAILED";
        case TaskStatus::REPLANNED: return "REPLANNED";
        case TaskStatus::PRESERVED: return "PRESERVED";
        default:                    return "UNKNOWN";
    }
}

inline TaskStatus stringToTaskStatus(const std::string& str) {
    if (str == "SCHEDULED") return TaskStatus::SCHEDULED;
    if (str == "FAILED")    return TaskStatus::FAILED;
    if (str == "REPLANNED") return TaskStatus::REPLANNED;
    if (str == "PRESERVED") return TaskStatus::PRESERVED;
    return TaskStatus::PENDING;
}

// Core Task domain entity
struct Task {
    std::string id;
    std::string name;
    std::string agentType; // "VENUE", "LOGISTICS", "SPEAKER"
    int duration = 0;      // In hours
    double cost = 0.0;
    int priority = 1;      // 1 (Low) to 5 (Critical)
    std::vector<std::string> dependencies;
    std::vector<std::string> requiredResources;

    int startTime = -1;
    int endTime = -1;
    TaskStatus status = TaskStatus::PENDING;

    bool isScheduled() const {
        return startTime >= 0 && endTime >= startTime;
    }
};

// JSON serialization for Task
inline void to_json(nlohmann::json& j, const Task& t) {
    j = nlohmann::json{
        {"id", t.id},
        {"name", t.name},
        {"agentType", t.agentType},
        {"duration", t.duration},
        {"cost", t.cost},
        {"priority", t.priority},
        {"dependencies", t.dependencies},
        {"requiredResources", t.requiredResources},
        {"startTime", t.startTime},
        {"endTime", t.endTime},
        {"status", taskStatusToString(t.status)}
    };
}

inline void from_json(const nlohmann::json& j, Task& t) {
    t.id = j.value("id", "");
    t.name = j.value("name", "");
    t.agentType = j.value("agentType", "");
    t.duration = j.value("duration", 0);
    t.cost = j.value("cost", 0.0);
    t.priority = j.value("priority", 1);
    t.dependencies = j.value("dependencies", std::vector<std::string>{});
    t.requiredResources = j.value("requiredResources", std::vector<std::string>{});
    t.startTime = j.value("startTime", -1);
    t.endTime = j.value("endTime", -1);
    t.status = stringToTaskStatus(j.value("status", "PENDING"));
}

// Temporal interval reservation record
struct TimeInterval {
    int start;
    int end;
    std::string taskId;
};

inline void to_json(nlohmann::json& j, const TimeInterval& ti) {
    j = nlohmann::json{
        {"start", ti.start},
        {"end", ti.end},
        {"taskId", ti.taskId}
    };
}

/**
 * ResourceManager (OOP Pillar: Encapsulation)
 * Private state stores resource capacities and time intervals.
 * Provides invariant-guarded mutators ensuring no overlapping intervals exceed capacity.
 */
class ResourceManager {
private:
    std::unordered_map<std::string, std::vector<TimeInterval>> reservations;
    std::unordered_map<std::string, int> capacities;

public:
    ResourceManager() = default;

    void registerResource(const std::string& id, int capacity = 1) {
        if (capacity < 1) {
            throw std::invalid_argument("Capacity must be at least 1 for resource: " + id);
        }
        capacities[id] = capacity;
        if (reservations.find(id) == reservations.end()) {
            reservations[id] = {};
        }
    }

    int getCapacity(const std::string& resourceId) const {
        auto it = capacities.find(resourceId);
        return (it != capacities.end()) ? it->second : 1;
    }

    std::vector<std::string> getAllResourceIds() const {
        std::vector<std::string> ids;
        for (const auto& kv : capacities) {
            ids.push_back(kv.first);
        }
        return ids;
    }

    const std::vector<TimeInterval>& getReservations(const std::string& resourceId) const {
        static const std::vector<TimeInterval> empty;
        auto it = reservations.find(resourceId);
        return (it != reservations.end()) ? it->second : empty;
    }

    /**
     * Checks if a resource has available capacity for the entire interval [start, end).
     */
    bool isAvailable(const std::string& resourceId, int start, int end) const {
        if (start < 0 || end <= start) {
            return false;
        }

        auto it = reservations.find(resourceId);
        if (it == reservations.end()) {
            return true; // Unregistered resources default to available
        }

        int capacity = getCapacity(resourceId);
        const auto& intervals = it->second;

        // Check concurrent reservations across all discrete hours in [start, end)
        for (int t = start; t < end; ++t) {
            int concurrentCount = 0;
            for (const auto& interval : intervals) {
                if (interval.start <= t && t < interval.end) {
                    concurrentCount++;
                    if (concurrentCount >= capacity) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    /**
     * Attempts to reserve [start, end) on a resource.
     * Enforces encapsulation invariants: returns false if capacity is violated.
     */
    bool reserve(const std::string& resourceId, int start, int end, const std::string& taskId) {
        if (!isAvailable(resourceId, start, end)) {
            return false;
        }
        reservations[resourceId].push_back({start, end, taskId});
        return true;
    }

    /**
     * Releases reservations for a specific task on a specific resource.
     */
    void release(const std::string& resourceId, const std::string& taskId) {
        auto it = reservations.find(resourceId);
        if (it != reservations.end()) {
            auto& list = it->second;
            list.erase(
                std::remove_if(list.begin(), list.end(), [&](const TimeInterval& ti) {
                    return ti.taskId == taskId;
                }),
                list.end()
            );
        }
    }

    /**
     * Releases all reservations held by a given task across all resources.
     */
    void releaseAllForTask(const std::string& taskId) {
        for (auto& kv : reservations) {
            auto& list = kv.second;
            list.erase(
                std::remove_if(list.begin(), list.end(), [&](const TimeInterval& ti) {
                    return ti.taskId == taskId;
                }),
                list.end()
            );
        }
    }

    /**
     * Clears all reservations while retaining resource registrations.
     */
    void clear() {
        for (auto& kv : reservations) {
            kv.second.clear();
        }
    }
};

// Plan and Recovery outcome structures
struct PlanMetrics {
    int makespan = 0;
    double totalCost = 0.0;
    int preservedTasksCount = 0;
    int replannedTasksCount = 0;
    int failedTasksCount = 0;
};

inline void to_json(nlohmann::json& j, const PlanMetrics& m) {
    j = nlohmann::json{
        {"makespan", m.makespan},
        {"totalCost", m.totalCost},
        {"preservedTasksCount", m.preservedTasksCount},
        {"replannedTasksCount", m.replannedTasksCount},
        {"failedTasksCount", m.failedTasksCount}
    };
}
