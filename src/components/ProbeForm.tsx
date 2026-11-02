import { useState, type FormEvent } from "react";

interface Props {
  probing: boolean;
  error: string | null;
  onProbe: (url: string) => void;
}

export function ProbeForm({ probing, error, onProbe }: Props) {
  const [url, setUrl] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!probing && url.trim()) onProbe(url.trim());
  }

  return (
    <form className="probe-form" onSubmit={submit}>
      <input
        type="url"
        value={url}
        placeholder="粘贴视频链接（YouTube / Bilibili / Twitter…）"
        onChange={(e) => setUrl(e.target.value)}
        disabled={probing}
        autoFocus
      />
      <button type="submit" disabled={probing || !url.trim()}>
        {probing ? "解析中…" : "解析"}
      </button>
      {error && <div className="probe-error">{error}</div>}
    </form>
  );
}
