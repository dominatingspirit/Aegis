#pragma once

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <sstream>
#include <cstring>
#include <winsock2.h>
#include <ws2tcpip.h>

#pragma comment(lib, "ws2_32.lib")

namespace httplib {

struct Request {
    std::string method;
    std::string path;
    std::string query_string;
    std::unordered_map<std::string, std::string> headers;
    std::string body;

    std::string get_header_value(const std::string& name) const {
        std::string lower_name = name;
        for (char& c : lower_name) c = std::tolower(static_cast<unsigned char>(c));
        for (const auto& pair : headers) {
            std::string lower_key = pair.first;
            for (char& c : lower_key) c = std::tolower(static_cast<unsigned char>(c));
            if (lower_key == lower_name) return pair.second;
        }
        return "";
    }
};

struct Response {
    int status = 200;
    std::unordered_map<std::string, std::string> headers;
    std::string body;

    void set_content(const std::string& s, const std::string& content_type) {
        body = s;
        headers["Content-Type"] = content_type;
    }

    void set_header(const std::string& key, const std::string& val) {
        headers[key] = val;
    }
};

using Handler = std::function<void(const Request&, Response&)>;

class Server {
private:
    std::unordered_map<std::string, Handler> get_routes;
    std::unordered_map<std::string, Handler> post_routes;
    std::unordered_map<std::string, Handler> options_routes;
    SOCKET server_socket = INVALID_SOCKET;
    bool is_running = false;

    static void parse_request(const std::string& raw, Request& req) {
        size_t header_end = raw.find("\r\n\r\n");
        std::string header_part = (header_end != std::string::npos) ? raw.substr(0, header_end) : raw;
        if (header_end != std::string::npos) {
            req.body = raw.substr(header_end + 4);
        }

        std::istringstream stream(header_part);
        std::string line;
        if (std::getline(stream, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            std::istringstream line_stream(line);
            line_stream >> req.method >> req.path;
            auto qpos = req.path.find('?');
            if (qpos != std::string::npos) {
                req.query_string = req.path.substr(qpos + 1);
                req.path = req.path.substr(0, qpos);
            }
        }

        while (std::getline(stream, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            auto colon = line.find(':');
            if (colon != std::string::npos) {
                std::string key = line.substr(0, colon);
                std::string val = line.substr(colon + 1);
                while (!val.empty() && val.front() == ' ') val.erase(val.begin());
                req.headers[key] = val;
            }
        }
    }

    static std::string build_response(const Response& res) {
        std::string status_msg = "OK";
        if (res.status == 404) status_msg = "Not Found";
        if (res.status == 400) status_msg = "Bad Request";
        if (res.status == 500) status_msg = "Internal Server Error";

        std::ostringstream ss;
        ss << "HTTP/1.1 " << res.status << " " << status_msg << "\r\n";
        ss << "Access-Control-Allow-Origin: *\r\n";
        ss << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n";
        ss << "Access-Control-Allow-Headers: Content-Type, Authorization, X-Scenario-Id, x-scenario-id, *\r\n";
        ss << "Content-Length: " << res.body.size() << "\r\n";

        for (const auto& h : res.headers) {
            ss << h.first << ": " << h.second << "\r\n";
        }
        ss << "Connection: close\r\n\r\n";
        ss << res.body;
        return ss.str();
    }

public:
    Server() {
        WSADATA wsa;
        WSAStartup(MAKEWORD(2, 2), &wsa);
    }

    ~Server() {
        stop();
        WSACleanup();
    }

    void Get(const std::string& path, Handler handler) {
        get_routes[path] = handler;
    }

    void Post(const std::string& path, Handler handler) {
        post_routes[path] = handler;
    }

    void Options(const std::string& path, Handler handler) {
        options_routes[path] = handler;
    }

    void stop() {
        is_running = false;
        if (server_socket != INVALID_SOCKET) {
            closesocket(server_socket);
            server_socket = INVALID_SOCKET;
        }
    }

    bool listen(const std::string& host, int port) {
        server_socket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (server_socket == INVALID_SOCKET) {
            std::cerr << "[Aegis Server] Failed to create socket." << std::endl;
            return false;
        }

        int opt = 1;
        setsockopt(server_socket, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

        sockaddr_in server_addr;
        server_addr.sin_family = AF_INET;
        server_addr.sin_addr.s_addr = (host == "0.0.0.0" || host == "localhost" || host == "127.0.0.1") 
                                       ? INADDR_ANY : inet_addr(host.c_str());
        server_addr.sin_port = htons(port);

        if (bind(server_socket, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
            std::cerr << "[Aegis Server] Bind failed on port " << port << std::endl;
            closesocket(server_socket);
            return false;
        }

        if (::listen(server_socket, SOMAXCONN) == SOCKET_ERROR) {
            std::cerr << "[Aegis Server] Listen failed." << std::endl;
            closesocket(server_socket);
            return false;
        }

        std::cout << "===================================================" << std::endl;
        std::cout << "  Project Aegis // Autonomous Coordination Engine  " << std::endl;
        std::cout << "  Server online: http://localhost:" << port << std::endl;
        std::cout << "===================================================" << std::endl;

        is_running = true;
        while (is_running) {
            sockaddr_in client_addr;
            int client_len = sizeof(client_addr);
            SOCKET client_sock = accept(server_socket, (sockaddr*)&client_addr, &client_len);
            if (client_sock == INVALID_SOCKET) {
                if (!is_running) break;
                continue;
            }

            char buffer[65536];
            int bytes_received = recv(client_sock, buffer, sizeof(buffer) - 1, 0);
            if (bytes_received > 0) {
                buffer[bytes_received] = '\0';
                Request req;
                parse_request(std::string(buffer, bytes_received), req);

                auto it_cl = req.headers.find("Content-Length");
                if (it_cl != req.headers.end()) {
                    size_t content_length = 0;
                    try { content_length = std::stoul(it_cl->second); } catch (...) {}
                    while (req.body.size() < content_length) {
                        int more_bytes = recv(client_sock, buffer, sizeof(buffer) - 1, 0);
                        if (more_bytes <= 0) break;
                        req.body.append(buffer, more_bytes);
                    }
                }

                Response res;
                // Handle CORS preflight
                if (req.method == "OPTIONS") {
                    res.status = 200;
                    res.set_content("", "text/plain");
                } else if (req.method == "GET") {
                    auto it = get_routes.find(req.path);
                    if (it != get_routes.end()) {
                        it->second(req, res);
                    } else {
                        res.status = 404;
                        res.set_content("{\"error\":\"Endpoint not found\"}", "application/json");
                    }
                } else if (req.method == "POST") {
                    auto it = post_routes.find(req.path);
                    if (it != post_routes.end()) {
                        it->second(req, res);
                    } else {
                        res.status = 404;
                        res.set_content("{\"error\":\"Endpoint not found\"}", "application/json");
                    }
                } else {
                    res.status = 405;
                    res.set_content("{\"error\":\"Method not allowed\"}", "application/json");
                }

                std::string raw_res = build_response(res);
                send(client_sock, raw_res.c_str(), static_cast<int>(raw_res.size()), 0);
            }
            closesocket(client_sock);
        }
        return true;
    }
};

} // namespace httplib
