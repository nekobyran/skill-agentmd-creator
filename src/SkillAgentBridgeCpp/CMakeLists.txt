cmake_minimum_required(VERSION 3.20)
project(SkillAgentBridgeCpp LANGUAGES CXX)

add_library(NativeSkillBridge SHARED
    skill_bridge.cpp
)

target_include_directories(NativeSkillBridge PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(NativeSkillBridge PRIVATE SKILLBRIDGE_EXPORTS)
set_target_properties(NativeSkillBridge PROPERTIES
    OUTPUT_NAME "NativeSkillBridge"
)
