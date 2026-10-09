'use client';

import { useEffect, useState } from 'react';

type Editor = { destroyEditor?: () => void };
type DocsApi = { DocEditor: new (elementId: string, config: unknown) => Editor };

const scripts = new Map<string, Promise<DocsApi>>();

/**
 * Loads the editing server's script once per page and keeps its tag in the document: the script
 * finds its own tag to work out the editing server's address, so the tag must not be removed.
 */
function loadDocsApi(scriptUrl: string): Promise<DocsApi> {
  let pending = scripts.get(scriptUrl);
  if (!pending) {
    pending = new Promise<DocsApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => {
        const api = (window as unknown as { DocsAPI?: DocsApi }).DocsAPI;
        if (api) resolve(api);
        else reject(new Error('editor unavailable'));
      };
      script.onerror = () => {
        scripts.delete(scriptUrl);
        script.remove();
        reject(new Error('editor unreachable'));
      };
      document.head.appendChild(script);
    });
    scripts.set(scriptUrl, pending);
  }
  return pending;
}

/**
 * Hosts the editing server's editor for one document. The editor is its own application, shown
 * in a frame it creates inside the placeholder below; this component loads its script, hands it
 * the signed configuration, and closes the editor on leaving.
 */
export function DocumentEditor({ scriptUrl, config }: { scriptUrl: string; config: unknown }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let editor: Editor | undefined;
    let cancelled = false;
    loadDocsApi(scriptUrl)
      .then((api) => {
        if (!cancelled) editor = new api.DocEditor('document-editor', config);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      editor?.destroyEditor?.();
    };
  }, [scriptUrl, config]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <p className="font-medium">The editor could not be reached</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The document editing service is not responding. Your document is safe in the library;
            you can download it, or try again in a moment.
          </p>
        </div>
      </div>
    );
  }
  // The editor replaces this element with its frame, so it is keyed to stay out of React's way.
  return (
    <div className="h-full w-full">
      <div id="document-editor" />
    </div>
  );
}
