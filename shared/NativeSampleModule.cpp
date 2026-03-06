#include "NativeSampleModule.h"

#include <stdexcept>
#include <cmath>

namespace facebook::react {

NativeSampleModule::NativeSampleModule(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeSampleModuleCxxSpec(std::move(jsInvoker)) {}

void NativeSampleModule::loadModel(jsi::Runtime& /*rt*/,
                                    std::string exportDir) {
    // Throws std::runtime_error on bad files — React Native will surface this
    // as a JS exception automatically via the TurboModule bridge.
    session_.loadModel(exportDir);
}

void NativeSampleModule::addReading(jsi::Runtime& /*rt*/,
                                     std::string csvLine) {
    session_.addReading(csvLine);
}

void NativeSampleModule::addEngineeredReading(jsi::Runtime& /*rt*/,
                                              std::string csvLine) {
    session_.addEngineeredReading(csvLine);
}

double NativeSampleModule::predict(jsi::Runtime& /*rt*/) {
    float result = session_.predict();
    // NAN propagates safely as a JS NaN through the double bridge
    return static_cast<double>(result);
}

void NativeSampleModule::reset(jsi::Runtime& /*rt*/) {
    session_.reset();
}

} // namespace facebook::react
