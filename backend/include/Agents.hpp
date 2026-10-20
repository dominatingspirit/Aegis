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

/**
 * VenueAgent (OOP Pillar: Inheritance)
 * Specializes in facility reservation, security clearance, and post-event cleanup.
 */
class VenueAgent : public Agent {
public:
    std::string getAgentName() const override { return "Venue Operations Agent"; }
    std::string getAgentType() const override { return "VENUE"; }

    AgentProposal generateProposals() override {
        AgentProposal proposal;
        proposal.agentName = getAgentName();
        proposal.agentType = getAgentType();

        Task hallBooking;
        hallBooking.id = "hall_booking";
        hallBooking.name = "Main Auditorium Booking";
        hallBooking.agentType = getAgentType();
        hallBooking.duration = 4;
        hallBooking.cost = 1200.0;
        hallBooking.priority = 5;
        hallBooking.dependencies = {};
        hallBooking.requiredResources = {"main_hall"};

        Task securityCheck;
        securityCheck.id = "security_check";
        securityCheck.name = "Security & Fire Safety Clearance";
        securityCheck.agentType = getAgentType();
        securityCheck.duration = 2;
        securityCheck.cost = 400.0;
        securityCheck.priority = 4;
        securityCheck.dependencies = {"hall_booking"};
        securityCheck.requiredResources = {"security_team"};

        proposal.tasks = {hallBooking, securityCheck};
        proposal.estimatedCost = hallBooking.cost + securityCheck.cost;
        return proposal;
    }
};

/**
 * LogisticsAgent (OOP Pillar: Inheritance)
 * Specializes in AV technical rigging and catering deployment.
 */
class LogisticsAgent : public Agent {
public:
    std::string getAgentName() const override { return "Logistics & AV Agent"; }
    std::string getAgentType() const override { return "LOGISTICS"; }

    AgentProposal generateProposals() override {
        AgentProposal proposal;
        proposal.agentName = getAgentName();
        proposal.agentType = getAgentType();

        Task avSetup;
        avSetup.id = "av_setup";
        avSetup.name = "Audio-Visual & Lighting Rigging";
        avSetup.agentType = getAgentType();
        avSetup.duration = 3;
        avSetup.cost = 800.0;
        avSetup.priority = 4;
        avSetup.dependencies = {"hall_booking"};
        avSetup.requiredResources = {"tech_crew"};

        Task cateringSetup;
        cateringSetup.id = "catering_setup";
        cateringSetup.name = "Buffet & Dining Logistics Setup";
        cateringSetup.agentType = getAgentType();
        cateringSetup.duration = 2;
        cateringSetup.cost = 1500.0;
        cateringSetup.priority = 3;
        cateringSetup.dependencies = {"hall_booking"};
        cateringSetup.requiredResources = {"catering_staff"};

        proposal.tasks = {avSetup, cateringSetup};
        proposal.estimatedCost = avSetup.cost + cateringSetup.cost;
        return proposal;
    }
};

/**
 * SpeakerAgent (OOP Pillar: Inheritance)
 * Specializes in dry-run rehearsals and executive keynote presentation.
 */
class SpeakerAgent : public Agent {
public:
    std::string getAgentName() const override { return "Speaker Coordination Agent"; }
    std::string getAgentType() const override { return "SPEAKER"; }

    AgentProposal generateProposals() override {
        AgentProposal proposal;
        proposal.agentName = getAgentName();
        proposal.agentType = getAgentType();

        Task rehearsal;
        rehearsal.id = "speaker_rehearsal";
        rehearsal.name = "Keynote Soundcheck & Dry Run";
        rehearsal.agentType = getAgentType();
        rehearsal.duration = 2;
        rehearsal.cost = 300.0;
        rehearsal.priority = 3;
        rehearsal.dependencies = {"av_setup"};
        rehearsal.requiredResources = {"tech_crew"};

        Task keynote;
        keynote.id = "keynote_session";
        keynote.name = "Keynote Address & Panel Q&A";
        keynote.agentType = getAgentType();
        keynote.duration = 3;
        keynote.cost = 2000.0;
        keynote.priority = 5;
        keynote.dependencies = {"speaker_rehearsal"};
        keynote.requiredResources = {"main_hall"};

        proposal.tasks = {rehearsal, keynote};
        proposal.estimatedCost = rehearsal.cost + keynote.cost;
        return proposal;
    }
};
