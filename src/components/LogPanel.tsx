interface Props {
  lines: string[];
  open: boolean;
  onToggle: () => void;
}

/** 原始 yt-dlp 日志（HalalDL 原则：工具说了有用的话，用户就该能看到） */
export function LogPanel({ lines, open, onToggle }: Props) {
  return (
    <div className="log-wrap">
      <button className="link" onClick={onToggle}>
        {open ? "收起日志" : `查看日志${lines.length ? ` (${lines.length})` : ""}`}
      </button>
      {open && (
        <pre className="log-panel">
          {lines.length === 0 ? "(暂无输出)" : lines.join("\n")}
        </pre>
      )}
    </div>
  );
}
