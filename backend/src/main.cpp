#include <iostream>
#include <fstream>
#include <memory>
#include <vector>
#include <chrono>
#include "httplib.h"
#include "json.hpp"
#include "Models.hpp"
#include "Agents.hpp"

// Global scenario file path
const std::string SCENARIO_FILE_PATH = "scenarios/symposium.json";

int main() {
    httplib::Server svr;

    // Health check endpoint
    svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
        auto now = std::chrono::system_clock::now();
        auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
        nlohmann::json response = {
            {"status", "ok"},
            {"service", "Aegis Core Engine"},
            {"version", "1.0.0"},
            {"architecture", "C++17 Multi-Agent Coordination"},
            {"timestamp", millis}
        };
        res.set_content(response.dump(2), "application/json");
    });

    // Scenario specification endpoint
    svr.Get("/api/scenario", [](const httplib::Request&, httplib::Response& res) {
        std::ifstream file(SCENARIO_FILE_PATH);
        if (!file.is_open()) {
            nlohmann::json err = {{"error", "Failed to load scenario file: " + SCENARIO_FILE_PATH}};
            res.status = 500;
            res.set_content(err.dump(2), "application/json");
            return;
        }

        nlohmann::json scenarioJson;
        file >> scenarioJson;
        res.set_content(scenarioJson.dump(2), "application/json");
    });

    // Registered Agents introspect endpoint (Demonstrating Polymorphism)
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

    std::cout << "[Project Aegis] Starting REST server on port 18080..." << std::endl;
    svr.listen("0.0.0.0", 18080);
    return 0;
}
