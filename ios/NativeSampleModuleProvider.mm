
#import "NativeSampleModuleProvider.h"
#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>
#import "NativeSampleModule.h"
#import <mach/mach.h>

// Measure CPU usage from last call to this call
extern "C" float perfGetCpuUsage(void) {

  // last cpu time total, and last last wall clocl time 
  static uint64_t lastProcMicros = 0;
  static std::chrono::steady_clock::time_point lastWall = std::chrono::steady_clock::now();

  // How much has each live thread worked, including termintad threads
  task_thread_times_info_data_t threadTimes;
  task_basic_info_data_t basicInfo;

  // Get CPU time for live threads and terminated threads. The sum of these is the total CPU time used by the process.
  mach_msg_type_number_t count = TASK_THREAD_TIMES_INFO_COUNT;
  kern_return_t kr = task_info(mach_task_self(),
                               TASK_THREAD_TIMES_INFO,
                               (task_info_t)&threadTimes,
                               &count);
  if (kr != KERN_SUCCESS) return -1.0f;

  count = TASK_BASIC_INFO_COUNT;
  kr = task_info(mach_task_self(),
                 TASK_BASIC_INFO,
                 (task_info_t)&basicInfo,
                 &count);
  if (kr != KERN_SUCCESS) return -1.0f;

  // Total process CPU time = live thread time + terminated thread time
  uint64_t userMicros =
      (uint64_t)threadTimes.user_time.seconds * 1000000ULL + threadTimes.user_time.microseconds +
      (uint64_t)basicInfo.user_time.seconds * 1000000ULL + basicInfo.user_time.microseconds;
  uint64_t systemMicros =
      (uint64_t)threadTimes.system_time.seconds * 1000000ULL + threadTimes.system_time.microseconds +
      (uint64_t)basicInfo.system_time.seconds * 1000000ULL + basicInfo.system_time.microseconds;
  uint64_t procMicros = userMicros + systemMicros;

  auto now = std::chrono::steady_clock::now();

  // First call edge cse
  if (lastProcMicros == 0) {
    lastProcMicros = procMicros;
    lastWall = now;
    return 0.0f;
  }

  // calculate CPU usage since last call as (delta CPU time) / (delta wall clock time)
  uint64_t microDelta = procMicros - lastProcMicros;
  float wallSeconds = std::chrono::duration<float>(now - lastWall).count();
  lastProcMicros = procMicros;
  lastWall = now;

  if (wallSeconds <= 0.0f) return 0.0f;

  // Convert microseconds of CPU time to percentage over wall-clock interval
  return (float)microDelta / 1000000.0f / wallSeconds * 100.0f;
}

@implementation NativeSampleModuleProvider

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSampleModule>(params.jsInvoker);
}

@end
