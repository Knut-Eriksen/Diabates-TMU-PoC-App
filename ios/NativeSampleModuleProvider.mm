
#import "NativeSampleModuleProvider.h"
#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>
#import "NativeSampleModule.h"
#import <mach/mach.h>

// Sums the CPU usage of every non idle thread and returns the total percentage
extern "C" float perfGetCpuUsage(void) {
  thread_array_t threadList;
  mach_msg_type_number_t threadCount;
  kern_return_t kr = task_threads(mach_task_self(), &threadList, &threadCount);
  if (kr != KERN_SUCCESS) return -1.0f;
  float total = 0.0f;
  for (mach_msg_type_number_t i = 0; i < threadCount; i++) {
    thread_info_data_t thinfo;
    mach_msg_type_number_t thInfoCount = THREAD_INFO_MAX;
    kr = thread_info(threadList[i], THREAD_BASIC_INFO, (thread_info_t)thinfo, &thInfoCount);
    if (kr == KERN_SUCCESS) {
      thread_basic_info_t basic = (thread_basic_info_t)thinfo;
      if (!(basic->flags & TH_FLAGS_IDLE))
        total += basic->cpu_usage / (float)TH_USAGE_SCALE * 100.0f;
    }
    mach_port_deallocate(mach_task_self(), threadList[i]);
  }
  vm_deallocate(mach_task_self(), (vm_offset_t)threadList, threadCount * sizeof(thread_t));
  return total;
}

@implementation NativeSampleModuleProvider

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSampleModule>(params.jsInvoker);
}

@end
