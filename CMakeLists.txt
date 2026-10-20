cmake_minimum_required(VERSION 3.16)
project(Aegis VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(backend/include)

add_executable(aegis_server backend/src/main.cpp)

if(WIN32)
    target_link_libraries(aegis_server ws2_32)
endif()
