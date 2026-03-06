#include "NativeSampleModule.h"

#include <stdexcept>
#include <cmath>

namespace facebook::react {

// Each method simply forwards to session_    
NativeSampleModule::NativeSampleModule(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeSampleModuleCxxSpec(std::move(jsInvoker)) {}

void NativeSampleModule::loadModel(jsi::Runtime&, std::string exportDir) {
    session_.loadModel(exportDir);
}

void NativeSampleModule::addReading(jsi::Runtime&, std::string csvLine) {
    session_.addReading(csvLine);
}

void NativeSampleModule::addEngineeredReading(jsi::Runtime&, std::string csvLine) {
    session_.addEngineeredReading(csvLine);
}

double NativeSampleModule::predict(jsi::Runtime&) {
    float result = session_.predict();
    return static_cast<double>(result);
}

void NativeSampleModule::reset(jsi::Runtime&) {
    session_.reset();
}

} // namespace facebook::react
