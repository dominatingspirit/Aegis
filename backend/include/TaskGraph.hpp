#pragma once

#include "Models.hpp"

#include <algorithm>
#include <queue>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

/**
 * Directed Acyclic Graph of tasks.
 *
 * An edge parent -> child exists when child.dependencies contains parent.
 *  - adj      : parent -> children   (used for BFS / Kahn's relaxation)
 *  - inEdges  : child  -> parents    (used for in-degree computation)
 *
 * Both maps are derived from the tasks' `dependencies` lists and are rebuilt
 * whenever tasks change, so insertion order never matters (a child may be
 * added before its parent) and the three structures can never drift apart.
 */
class TaskGraph {
private:
    std::unordered_map<std::string, Task> tasks;
    std::unordered_map<std::string, std::vector<std::string>> adj;      // parent -> children
    std::unordered_map<std::string, std::vector<std::string>> inEdges;  // child -> parents

    void rebuildEdges() {
        adj.clear();
        inEdges.clear();
        for (const auto& kv : tasks) {
            const Task& child = kv.second;
            std::unordered_set<std::string> seen;  // ignore duplicate dependency entries
            for (const std::string& parentId : child.dependencies) {
                if (tasks.find(parentId) == tasks.end()) continue;  // dangling dependency
                if (!seen.insert(parentId).second) continue;
                adj[parentId].push_back(child.id);
                inEdges[child.id].push_back(parentId);
            }
        }
    }

    // Kahn's algorithm. Returns every task it could emit; if the result is
    // shorter than tasks.size(), the remainder is stuck on a cycle.
    std::vector<std::string> kahn() const {
        std::unordered_map<std::string, int> inDegree;
        for (const auto& kv : tasks) {
            auto it = inEdges.find(kv.first);
            inDegree[kv.first] = (it == inEdges.end()) ? 0 : static_cast<int>(it->second.size());
        }

        // Deterministic tie-break: higher priority first, then id.
        auto byPriority = [this](const std::string& a, const std::string& b) {
            const Task& ta = tasks.at(a);
            const Task& tb = tasks.at(b);
            if (ta.priority != tb.priority) return ta.priority > tb.priority;
            return a < b;
        };

        std::vector<std::string> ready;
        for (const auto& kv : inDegree) {
            if (kv.second == 0) ready.push_back(kv.first);
        }
        std::sort(ready.begin(), ready.end(), byPriority);

        std::queue<std::string> q;
        for (const std::string& id : ready) q.push(id);

        std::vector<std::string> order;
        order.reserve(tasks.size());
        while (!q.empty()) {
            const std::string id = q.front();
            q.pop();
            order.push_back(id);

            auto children = adj.find(id);
            if (children == adj.end()) continue;

            std::vector<std::string> nowReady;
            for (const std::string& child : children->second) {
                if (--inDegree[child] == 0) nowReady.push_back(child);
            }
            std::sort(nowReady.begin(), nowReady.end(), byPriority);
            for (const std::string& r : nowReady) q.push(r);
        }
        return order;
    }

public:
    // Throws std::invalid_argument on empty or duplicate id.
    void addTask(const Task& task) {
        if (task.id.empty()) throw std::invalid_argument("Task id must not be empty");
        if (tasks.find(task.id) != tasks.end()) {
            throw std::invalid_argument("Duplicate task id: " + task.id);
        }
        tasks[task.id] = task;
        rebuildEdges();
    }

    bool hasCycle() const { return kahn().size() != tasks.size(); }

    // Throws std::runtime_error if the graph contains a cycle.
    std::vector<std::string> getTopologicalOrder() const {
        std::vector<std::string> order = kahn();
        if (order.size() != tasks.size()) {
            throw std::runtime_error("Cycle detected in task graph: no valid topological order");
        }
        return order;
    }

    // BFS over adj. Includes failedTaskId itself; empty set if the id is unknown.
    std::unordered_set<std::string> getDownstreamSubgraph(const std::string& failedTaskId) const {
        std::unordered_set<std::string> visited;
        if (tasks.find(failedTaskId) == tasks.end()) return visited;

        std::queue<std::string> q;
        q.push(failedTaskId);
        visited.insert(failedTaskId);
        while (!q.empty()) {
            const std::string id = q.front();
            q.pop();
            auto children = adj.find(id);
            if (children == adj.end()) continue;
            for (const std::string& child : children->second) {
                if (visited.insert(child).second) q.push(child);
            }
        }
        return visited;
    }

    Task* getTask(const std::string& id) {
        auto it = tasks.find(id);
        return it == tasks.end() ? nullptr : &it->second;
    }

    const Task* getTask(const std::string& id) const {
        auto it = tasks.find(id);
        return it == tasks.end() ? nullptr : &it->second;
    }

    const std::unordered_map<std::string, Task>& getAllTasks() const { return tasks; }

    // Replaces an existing task (its dependencies may have changed).
    // Throws std::out_of_range if the id is unknown.
    void updateTask(const Task& task) {
        auto it = tasks.find(task.id);
        if (it == tasks.end()) throw std::out_of_range("Unknown task id: " + task.id);
        it->second = task;
        rebuildEdges();
    }

    void clear() {
        tasks.clear();
        adj.clear();
        inEdges.clear();
    }
};
