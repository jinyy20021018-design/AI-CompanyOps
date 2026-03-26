import fs from "node:fs";
import path from "node:path";
import { getHoncho, getAgentPeerId, getCoordinatorPeerId, getProjectSessionId, isHonchoAvailable } from "./honchoClient.js";

/** Record a spawn lifecycle event to Honcho (fire-and-forget) */
export function recordSpawnEvent(sessionName: string, folderPath: string, label: string): void {
  if (!isHonchoAvailable()) return;
  (async () => {
    try {
      const honcho = getHoncho();
      const peer = await honcho.peer(getAgentPeerId(sessionName));
      const hSession = await honcho.session(getProjectSessionId(folderPath), {
        metadata: { type: "project", folderPath },
      });
      await hSession.addPeers(peer);
      await hSession.addMessages([
        peer.message(
          `Agent "${label}" started in session "${sessionName}"`,
          { metadata: { type: "lifecycle", event: "spawn" } }
        ),
      ]);
    } catch (e) { console.warn("[honcho] spawn record failed:", e); }
  })();
}

/** Record an exit lifecycle event to Honcho (fire-and-forget) */
export function recordExitEvent(sessionName: string, folderPath: string, exitCode: number): void {
  if (!isHonchoAvailable()) return;
  (async () => {
    try {
      const honcho = getHoncho();
      const peer = await honcho.peer(getAgentPeerId(sessionName));
      const hSession = await honcho.session(getProjectSessionId(folderPath));
      await hSession.addMessages([
        peer.message(
          `Agent "${sessionName}" exited (code: ${exitCode})`,
          { metadata: { type: "lifecycle", event: "exit", exitCode } }
        ),
      ]);
    } catch (e) { console.warn("[honcho] exit record failed:", e); }
  })();
}

/** Inject cross-project Honcho memory into coordinator CLAUDE.md */
export async function injectCoordinatorContext(sessionDir: string, folderPath: string): Promise<void> {
  if (!isHonchoAvailable()) return;
  try {
    const honcho = getHoncho();
    const coordinatorPeer = await honcho.peer(getCoordinatorPeerId(folderPath));
    const rep = await coordinatorPeer.representation({
      searchQuery: "project context patterns knowledge",
      searchTopK: 15,
    });
    if (rep) {
      const claudeMdPath = path.join(sessionDir, "CLAUDE.md");
      const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, "utf-8") : "";
      fs.writeFileSync(claudeMdPath, existing + `\n\n## Cross-Project Memory\n\n${rep}\n`);
    }
  } catch (e) { console.warn("[honcho] context injection failed:", e); }
}
