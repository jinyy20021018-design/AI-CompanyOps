import { useState, useEffect, useCallback } from "react";
import type { ArtifactFileInfo, ServerMessage } from "../types";

export type ArtifactContents = Record<string, string>;

export function usePresentationArtifacts(
  terminalId: string | null,
  send: (msg: object) => void,
  addHandler: (handler: (msg: ServerMessage) => void) => () => void
): { files: ArtifactFileInfo[]; contents: ArtifactContents; loading: boolean } {
  const [files, setFiles] = useState<ArtifactFileInfo[]>([]);
  const [contents, setContents] = useState<ArtifactContents>({});
  const [loading, setLoading] = useState(false);

  const fetchContent = useCallback(
    (fileName: string) => {
      if (!terminalId) return;
      send({ type: "artifact:read", terminalId, fileName });
    },
    [terminalId, send]
  );

  useEffect(() => {
    if (!terminalId) return;
    setFiles([]);
    setContents({});
    setLoading(true);
    send({ type: "artifact:list", terminalId });
  }, [terminalId, send]);

  useEffect(() => {
    if (!terminalId) return;
    return addHandler((msg: ServerMessage) => {
      if (msg.type === "artifact:update" && msg.terminalId === terminalId) {
        setFiles(msg.files);
        for (const f of msg.files) {
          fetchContent(f.name);
        }
      }
      if (msg.type === "artifact:content" && msg.terminalId === terminalId) {
        setContents((prev) => {
          const updated = { ...prev, [msg.fileName]: msg.content };
          return updated;
        });
      }
    });
  }, [terminalId, addHandler, fetchContent]);

  useEffect(() => {
    if (files.length === 0) return;
    const allLoaded = files.every((f) => contents[f.name] !== undefined);
    if (allLoaded) setLoading(false);
  }, [files, contents]);

  return { files, contents, loading };
}
