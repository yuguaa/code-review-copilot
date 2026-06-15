import { createLogger, logWarn } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { interruptRuntimeCommand } from "@/lib/services/pi-runtime-process";

const log = createLogger("PiRuntimeCommandRegistry");

type RunningPiCommand = {
  controller: AbortController;
  sandboxId: string;
  commandId: string | null;
  interruptRequested: boolean;
};

const runningPiCommands = new Map<string, RunningPiCommand>();

function interruptSandboxCommand(reviewLogId: string, sandboxId: string, commandId: string): Promise<void> {
  return interruptRuntimeCommand(commandId).catch((error) => {
    logWarn(log, error, "Failed to interrupt running Pi command", {
      reviewLogId,
      sandboxId,
      commandId,
    });
  });
}

export function registerRunningPiCommand(reviewLogId: string, sandboxId: string): AbortController {
  const controller = new AbortController();
  runningPiCommands.set(reviewLogId, {
    controller,
    sandboxId,
    commandId: null,
    interruptRequested: false,
  });
  return controller;
}

export function bindRunningPiCommandId(reviewLogId: string, commandId: string): Promise<void> {
  const running = runningPiCommands.get(reviewLogId);
  if (!running) return Promise.resolve();
  running.commandId = commandId;
  if (!running.interruptRequested) return Promise.resolve();
  return interruptSandboxCommand(reviewLogId, running.sandboxId, commandId);
}

export function unregisterRunningPiCommand(reviewLogId: string): void {
  runningPiCommands.delete(reviewLogId);
}

export function interruptRunningPiCommand(reviewLogId: string): Promise<void> {
  const running = runningPiCommands.get(reviewLogId);
  if (!running) {
    return prisma.reviewSandboxSession.findUnique({
      where: { reviewLogId },
      select: {
        sandboxId: true,
        piCommandId: true,
      },
    }).then((session) => {
      if (!session?.piCommandId) return undefined;
      return interruptSandboxCommand(reviewLogId, session.sandboxId, session.piCommandId);
    });
  }

  running.interruptRequested = true;
  running.controller.abort(new Error(`Review ${reviewLogId} was cancelled`));

  const commandId = running.commandId;
  if (!commandId) {
    return Promise.resolve();
  }

  return interruptSandboxCommand(reviewLogId, running.sandboxId, commandId);
}
