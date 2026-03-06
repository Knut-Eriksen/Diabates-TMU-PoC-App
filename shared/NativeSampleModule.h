#pragma once

#include <AppSpecsJSI.h>
#include "GlucoseSession.h"

#include <memory>
#include <string>

namespace facebook::react {

class NativeSampleModule
    : public NativeSampleModuleCxxSpec<NativeSampleModule> {
public:
    NativeSampleModule(std::shared_ptr<CallInvoker> jsInvoker);

    // Load model from a directory path (must contain meta.json + .bin files).
    // Call once on app start after you know where the export files are.
    void loadModel(jsi::Runtime& rt, std::string exportDir);

    // Add one CGM reading. Format (no header):
    //   "YYYY-MM-DD HH:MM:SS,glucose,missing_bg,meal,exercise,
    //    heart_rate,gsr,steps,sleep,bolus,basal"
    // Call every 5 minutes as new sensor data arrives.
    void addReading(jsi::Runtime& rt, std::string csvLine);

    // Add one fully engineered reading (all model features present, no header).
    void addEngineeredReading(jsi::Runtime& rt, std::string csvLine);

    // Return the predicted glucose for the most recent complete row.
    // Returns NaN (as a double) if the model isn't loaded or there isn't
    // enough history yet. Check with isNaN() on the JS side.
    double predict(jsi::Runtime& rt);

    // Clear accumulated history. Model stays loaded.
    void reset(jsi::Runtime& rt);

private:
    glucose::GlucoseSession session_;
};

} // namespace facebook::react
