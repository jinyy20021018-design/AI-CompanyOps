import { Honcho } from "@honcho-ai/sdk";

let _honcho: Honcho | null = null;

export function getHoncho(): Honcho {
  if (!_honcho) {
    _honcho = new Honcho({
      workspaceId: "terminal-canvas",
      apiKey: process.env.HONCHO_API_KEY,
    });
  }
  return _honcho;
}

export function getAgentPeerId(sessionName: string): string {
  return `agent-${sessionName}`;
}

export function getCoordinatorPeerId(folderPath: string): string {
  const folderId = folderPath.replace(/[\/\s.]/g, "-");
  return `coordinator-${folderId}`;
}

export function getProjectSessionId(folderPath: string): string {
  const folderId = folderPath.replace(/[\/\s.]/g, "-");
  return `project-${folderId}`;
}
