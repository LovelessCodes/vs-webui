import Editor from "@monaco-editor/react";

import "@/lib/monaco";

/** Monaco JSON editor, loaded lazily so the core bundle stays small. */
export default function MonacoEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Editor
      height="100%"
      language="json"
      onChange={onChange}
      options={{
        fontSize: 13,
        lineNumbers: "on",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
      }}
      theme="vs-dark"
      value={value}
    />
  );
}
