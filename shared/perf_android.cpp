#include <chrono>
#include <cstdio>

// Android implementation used by shared NativeSampleModule.cpp.
// Returns process CPU usage as a percentage since the previous call.
extern "C" float perfGetCpuUsage(void) {
  static long long lastProcTicks = 0;
  static std::chrono::steady_clock::time_point lastWall = std::chrono::steady_clock::now();

  FILE* f = std::fopen("/proc/self/stat", "r");
  if (!f) {
    return -1.0f;
  }

  int pid = 0;
  char comm[256] = {0};
  char state = 0;
  long long ppid = 0, pgrp = 0, session = 0, tty_nr = 0, tpgid = 0;
  unsigned long long flags = 0, minflt = 0, cminflt = 0, majflt = 0, cmajflt = 0;
  long long utime = 0, stime = 0;

  int parsed = std::fscanf(
      f,
      "%d %255s %c %lld %lld %lld %lld %lld %llu %llu %llu %llu %llu %lld %lld",
      &pid,
      comm,
      &state,
      &ppid,
      &pgrp,
      &session,
      &tty_nr,
      &tpgid,
      &flags,
      &minflt,
      &cminflt,
      &majflt,
      &cmajflt,
      &utime,
      &stime);
  std::fclose(f);

  if (parsed < 15) {
    return -1.0f;
  }

  constexpr float kTicksPerSecond = 100.0f; // Linux/Android USER_HZ
  const long long procTicks = utime + stime;
  const auto now = std::chrono::steady_clock::now();

  if (lastProcTicks == 0) {
    lastProcTicks = procTicks;
    lastWall = now;
    return 0.0f;
  }

  const long long tickDelta = procTicks - lastProcTicks;
  const float wallSeconds = std::chrono::duration<float>(now - lastWall).count();

  lastProcTicks = procTicks;
  lastWall = now;

  if (wallSeconds <= 0.0f) {
    return 0.0f;
  }

  return (static_cast<float>(tickDelta) / kTicksPerSecond) / wallSeconds * 100.0f;
}
