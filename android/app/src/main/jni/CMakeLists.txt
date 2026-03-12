cmake_minimum_required(VERSION 3.13)

project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

target_sources(${CMAKE_PROJECT_NAME} PRIVATE
  ../../../../../shared/NativeSampleModule.cpp
  ../../../../../shared/GlucoseSession.cpp
  ../../../../../shared/inference.cpp
)


target_include_directories(${CMAKE_PROJECT_NAME} PUBLIC
  ../../../../../shared
)