#pragma once

#include <string>
#include <vector>
#include <memory>
#include "Models.hpp"
#include "json.hpp"

// Proposal returned by an autonomous planning agent
struct AgentProposal {
    std::string agentName;
    std::string agentType;
    std::vector<Task> tasks;
    double estimatedCost = 0.0;
};

inline void to_json(nlohmann::json& j, const AgentProposal& p) {
    j = nlohmann::json{
        {"agentName", p.agentName},
        {"agentType", p.agentType},
        {"tasks", p.tasks},
        {"estimatedCost", p.estimatedCost}
    };
}

/**
 * Agent (OOP Pillar: Abstraction)
 * Pure virtual abstract base class defining the contract for all autonomous specialized agents.
 * Subclasses implement domain-specific task generation without knowledge of global scheduling.
 */
class Agent {
public:
    virtual ~Agent() = default;

    // Pure virtual methods enforcing interface contract
    virtual std::string getAgentName() const = 0;
    virtual std::string getAgentType() const = 0;
    virtual AgentProposal generateProposals() = 0;
};
