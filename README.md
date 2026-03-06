# iOS Run Guide

This README explains how to run the project on **iOS**.

It is based on React Native’s **Cross-Platform Native Modules (C++)** guide and adapted to this project, which uses a **Pure C++ TurboModule** plus bundled model files (`meta.json` and `.bin` files).

---

## What this project is doing on iOS

The app uses:

- a **TypeScript TurboModule spec** in `specs/NativeSampleModule.ts`
- a **Pure C++ module** in your shared/native code
- an **Objective-C++ ModuleProvider** on iOS to expose the C++ TurboModule to React Native
- several **model export files** that must be included in the iOS app bundle:
  - `meta.json`
  - `thresholds.bin`
  - `pos_mask.bin`
  - `neg_mask.bin`
  - `head_clause_weights.bin`
  - `head_intercept.bin`

Your `App.tsx` copies those files from `RNFS.MainBundlePath` into the app documents directory at startup, then calls:

- `NativeSampleModule.loadModel(...)`
- `NativeSampleModule.addReading(...)`
- `NativeSampleModule.predict()`

So for iOS to work, **two things must be correct**:

1. the TurboModule must be registered correctly
2. the model files must be bundled into the iOS app target

---

## Prerequisites

Before running on iOS, make sure you have:

- macOS
- Xcode installed
- CocoaPods installed
- Ruby/Bundler available
- Node.js + npm or Yarn
- React Native dependencies installed

From the project root:

```bash
npm install
```

or:

```bash
yarn
```

---

## 1. Make sure the TurboModule spec exists

Your project should have a file like:

```text
specs/NativeSampleModule.ts
```

Important: the official React Native guide requires TurboModule spec files to start with `Native`, otherwise Codegen ignores them.

Your spec should expose the methods you use from JS, such as:

- `loadModel(exportDir: string)`
- `addReading(csvLine: string)`
- `addEngineeredReading(csvLine: string)`
- `predict()`
- `reset()`

---

## 2. Configure `package.json` for Codegen

React Native Codegen must know:

- the specs are in `specs/`
- the generated namespace is `AppSpecs`
- iOS should map `NativeSampleModule` to your iOS provider class

Your `package.json` should contain a `codegenConfig` like this:

```json
{
  "codegenConfig": {
    "name": "AppSpecs",
    "type": "modules",
    "jsSrcsDir": "specs",
    "android": {
      "javaPackageName": "com.sampleapp.specs"
    },
    "ios": {
      "modulesProvider": {
        "NativeSampleModule": "NativeSampleModuleProvider"
      }
    }
  }
}
```

If `ios.modulesProvider` is missing, iOS will not know how to instantiate your Pure C++ TurboModule.

---

## 3. Keep the C++ code in a shared folder

The React Native guide expects the shared C++ code to live in a folder like:

```text
shared/
```

In your case that folder should contain files like:

```text
shared/
  GlucoseSession.h
  GlucoseSession.cpp
  inference.h
  inference.cpp
  inference_types.h
  NativeSampleModule.h
  NativeSampleModule.cpp
```

This shared code is what the iOS app must compile into the target.

---

## 4. Install pods and run Codegen

From the `ios` folder run:

```bash
cd ios
bundle install
bundle exec pod install
```

This is important because `pod install` also runs React Native Codegen for the TurboModule scaffolding.

If you later change:

- the TypeScript spec
- the `package.json` codegen config
- the module provider mapping

run this again:

```bash
cd ios
bundle exec pod install
```

---

## 5. Open the iOS workspace, not the `.xcodeproj`

Open the CocoaPods workspace:

```bash
cd ios
open *.xcworkspace
```

Usually this will be something like:

```bash
open SampleApp.xcworkspace
```

Always open the `.xcworkspace`, not the `.xcodeproj`, because CocoaPods integration lives in the workspace.

---

## 6. Add the `shared/` folder to the Xcode project

The React Native guide requires adding the `shared` folder to the iOS project so Xcode can see and compile the C++ files.

In Xcode:

1. Open the workspace.
2. In the left sidebar, click the app project.
3. Right-click the project or use **File → Add Files to ...**
4. Select the `shared/` folder.
5. Add it to the app project.

Make sure the relevant `.cpp` and `.h` files appear inside Xcode afterward.

If this step is skipped, iOS builds usually fail with missing headers or undefined symbols because the C++ source files are not part of the target.

---

## 7. Create the iOS ModuleProvider

Pure C++ TurboModules on iOS need an Objective-C++ provider class.

Create these files in the iOS app target:

```text
ios/NativeSampleModuleProvider.h
ios/NativeSampleModuleProvider.mm
```

### `NativeSampleModuleProvider.h`

```objc
#import <Foundation/Foundation.h>
#import <ReactCommon/RCTTurboModule.h>

NS_ASSUME_NONNULL_BEGIN

@interface NativeSampleModuleProvider : NSObject <RCTModuleProvider>
@end

NS_ASSUME_NONNULL_END
```

### `NativeSampleModuleProvider.mm`

```objc
#import "NativeSampleModuleProvider.h"
#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>
#import "NativeSampleModule.h"

@implementation NativeSampleModuleProvider

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSampleModule>(params.jsInvoker);
}

@end
```

Important:

- the implementation file must be `.mm`, not `.m`
- `.mm` means Objective-C++, which is required because the provider constructs a C++ object
- the provider name must match the name used in `package.json`:

```json
"ios": {
  "modulesProvider": {
    "NativeSampleModule": "NativeSampleModuleProvider"
  }
}
```

---

## 8. Re-run pods after adding the provider mapping

Once the provider exists and `package.json` is updated, run:

```bash
cd ios
bundle exec pod install
```

That forces Codegen / pod integration to pick up the iOS provider mapping.

---

## 9. Bundle the model files into the iOS app

This project has one extra step beyond the generic React Native guide.

Your `App.tsx` does this on startup:

- reads files from `RNFS.MainBundlePath`
- copies them into `DocumentDirectoryPath/mobile_export`
- then loads the model from there

That means these files **must exist in the iOS app bundle**:

```text
meta.json
thresholds.bin
pos_mask.bin
neg_mask.bin
head_clause_weights.bin
head_intercept.bin
```

### How to add them in Xcode

1. In Xcode, right-click the app project.
2. Choose **Add Files to ...**
3. Select those six files.
4. Make sure **Copy items if needed** is checked.
5. Make sure the app target is selected.

### Verify target membership

For each file in Xcode:

1. click the file
2. open the File Inspector on the right
3. confirm your app target is checked under **Target Membership**

If these files are not bundled, startup will fail when this code runs:

```ts
const src = `${RNFS.MainBundlePath}/${file}`;
await RNFS.copyFile(src, dest);
```

Typical symptom:

- the app launches
- file copy fails
- you get a log/alert like “File copy failed” or “Model load failed”

---

## 10. Confirm the JS/native names match exactly

These names must agree across the project:

### In TypeScript spec

```ts
export default TurboModuleRegistry.getEnforcing<Spec>('NativeSampleModule');
```

### In C++ class

Your class is `NativeSampleModule` and extends the generated C++ spec base.

### In `package.json`

```json
"ios": {
  "modulesProvider": {
    "NativeSampleModule": "NativeSampleModuleProvider"
  }
}
```

### In provider implementation

```objc
return std::make_shared<facebook::react::NativeSampleModule>(params.jsInvoker);
```

If one of these names does not match exactly, JS will fail to find the native module.

---

## 11. Build and run from Xcode

After all setup is complete:

1. Open the workspace in Xcode.
2. Select an iPhone simulator.
3. Choose the app target.
4. Press **Run**.

If everything is configured correctly, the app should:

1. launch
2. copy the bundled model files into documents
3. load the model through `NativeSampleModule.loadModel(...)`
4. show the “Model loaded” status in the UI

---

## 12. Or run from the command line

From the project root:

```bash
npx react-native run-ios
```

or:

```bash
yarn react-native run-ios
```

This still depends on the iOS project being configured correctly in Xcode.

---

## 13. What should happen when it works

When the app starts successfully:

- model files are copied from the iOS bundle to documents
- `NativeSampleModule.loadModel(destDir)` succeeds
- the UI shows something like:

```text
✓ Model loaded
```

Then:

- **Run Python Timeline** feeds the full hardcoded timeline
- **Add + Predict** sends a custom CSV line
- `predict()` returns `NaN` until enough history exists
- once enough readings have been added, the prediction box shows a glucose value in mg/dL

---

## 14. Common iOS problems and fixes

### Problem: `TurboModuleRegistry.getEnforcing(...): 'NativeSampleModule' could not be found`

Usually means one of these is wrong:

- `package.json` missing `ios.modulesProvider`
- provider class name mismatch
- provider files not in the iOS target
- pods not reinstalled after config changes

### Fix

Run:

```bash
cd ios
bundle exec pod install
open *.xcworkspace
```

Then verify:

- `NativeSampleModuleProvider.h/.mm` exist
- provider is in the app target
- names match exactly

---

### Problem: build fails with C++ header not found

Usually means:

- `shared/` folder was not added to Xcode
- header search / file references are missing
- `NativeSampleModule.h` is not visible to the provider file

### Fix

Re-add the `shared/` folder to the Xcode project and make sure the files are visible to the target.

---

### Problem: app starts but says `File copy failed`

Usually means the model export files are not bundled into the app.

### Fix

Make sure these files are in the app target:

- `meta.json`
- `thresholds.bin`
- `pos_mask.bin`
- `neg_mask.bin`
- `head_clause_weights.bin`
- `head_intercept.bin`

---

### Problem: app starts but says `Model load failed`

Usually means:

- one or more model files are missing
- file names do not match what the C++ loader expects
- `meta.json` references files that are not present
- exported binary sizes do not match metadata

### Fix

Check that all six files are bundled and copied correctly, and that the export directory contains exactly the files your loader expects.

---

### Problem: app runs but `predict()` keeps returning `NaN`

Usually means the session does not yet have enough valid history for all engineered features.

### Fix

Feed more readings using:

- **Run Python Timeline**
- repeated **Add + Predict** calls

This is expected during warm-up.

---

## 15. Recommended project checklist

Use this checklist when setting up a fresh clone on iOS:

- [ ] `npm install` or `yarn`
- [ ] `specs/NativeSampleModule.ts` exists
- [ ] `package.json` contains `codegenConfig`
- [ ] `package.json` contains `ios.modulesProvider`
- [ ] `shared/` folder exists with the C++ files
- [ ] `cd ios && bundle install && bundle exec pod install`
- [ ] open `.xcworkspace`
- [ ] add `shared/` folder to Xcode
- [ ] create `NativeSampleModuleProvider.h`
- [ ] create `NativeSampleModuleProvider.mm`
- [ ] re-run `bundle exec pod install`
- [ ] add all model files to Xcode target membership
- [ ] run from Xcode or `npx react-native run-ios`

---

## 16. Minimal run commands

If the project is already configured correctly, the shortest run path is:

```bash
npm install
cd ios
bundle install
bundle exec pod install
open *.xcworkspace
```

Then press **Run** in Xcode.

Or from the project root:

```bash
npx react-native run-ios
```

---

## 17. Notes specific to this project

A few project-specific details from your code:

1. The app copies model files from `RNFS.MainBundlePath`, so bundling the files into iOS is mandatory.
2. The native module is not a regular Objective-C module; it is a **Pure C++ TurboModule** exposed through an Objective-C++ provider.
3. Your app supports both:
   - raw 11-field CSV lines via `addReading(...)`
   - engineered 21-field CSV lines via `addEngineeredReading(...)`
4. `predict()` may return `NaN` until enough history exists to compute rolling features.

---

## 18. Official guide used

This setup follows the React Native guide for **Cross-Platform Native Modules (C++)**, especially the iOS steps for:

- installing pods / running Codegen
- adding the `shared` folder to the iOS project
- creating a `ModuleProvider`
- setting `ios.modulesProvider` in `package.json`

