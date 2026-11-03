import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import amazon from "../assets/Amazon.svg";
import bilibili from "../assets/Bilibili.svg";
import dailymotion from "../assets/Dailymotion.svg";
import facebook from "../assets/Facebook.svg";
import instagram from "../assets/Instagram.svg";
import linkedIn from "../assets/LinkedIn.svg";
import neteaseCloudMusic from "../assets/Netease_Cloud_Music.svg";
import pinterest from "../assets/Pinterest.svg";
import reddit from "../assets/Reddit.svg";
import snapchat from "../assets/Snapchat.svg";
import soundCloud from "../assets/SoundCloud.svg";
import spotify from "../assets/Spotify.svg";
import suno from "../assets/Suno.svg";
import threads from "../assets/Threads.svg";
import tiktok from "../assets/TikTok.svg";
import tumblr from "../assets/Tumblr.svg";
import twitch from "../assets/Twitch.svg";
import twitter from "../assets/Twitter.svg";
import vimeo from "../assets/Vimeo.svg";
import vk from "../assets/VK.svg";
import weibo from "../assets/Weibo.svg";
import xTwitter from "../assets/X_Twitter.svg";
import xiaohongshu from "../assets/Xiaohongshu.svg";
import youtube from "../assets/YouTube.svg";

const platforms = [
  { name: "YouTube", logo: youtube },
  { name: "哔哩哔哩", logo: bilibili },
  { name: "TikTok", logo: tiktok },
  { name: "小红书", logo: xiaohongshu },
  { name: "Instagram", logo: instagram },
  { name: "Facebook", logo: facebook },
  { name: "Twitter", logo: twitter },
  { name: "X", logo: xTwitter },
  { name: "Threads", logo: threads },
  { name: "Twitch", logo: twitch },
  { name: "Vimeo", logo: vimeo },
  { name: "Dailymotion", logo: dailymotion },
  { name: "SoundCloud", logo: soundCloud },
  { name: "Spotify", logo: spotify },
  { name: "网易云音乐", logo: neteaseCloudMusic },
  { name: "Suno", logo: suno },
  { name: "Reddit", logo: reddit },
  { name: "Pinterest", logo: pinterest },
  { name: "Snapchat", logo: snapchat },
  { name: "LinkedIn", logo: linkedIn },
  { name: "Tumblr", logo: tumblr },
  { name: "VK", logo: vk },
  { name: "微博", logo: weibo },
  { name: "Amazon", logo: amazon },
] as const;

export function PlatformWall() {
  const scroller = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const inertiaActive = useRef(false);
  const inertiaFrame = useRef(0);
  const lastPointer = useRef({ x: 0, y: 0 });
  const lastMoveTime = useRef(0);
  const velocity = useRef({ x: 0, y: 0 });
  const autoOffset = useRef(0);
  const autoResumeAt = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth / 3;
    el.scrollTop = el.scrollHeight / 3;
  }, []);

  useEffect(() => {
    const el = scroller.current;
    const rows = rowsRef.current;
    if (!el || !rows) return;

    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(now - previous, 32);
      if (!dragging.current && !inertiaActive.current && now >= autoResumeAt.current) {
        const period = el.scrollWidth / 3;
        autoOffset.current -= elapsed * 0.012;
        if (autoOffset.current <= -period) autoOffset.current += period;
        rows.style.transform = `translate3d(${autoOffset.current}px, 0, 0)`;
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(inertiaFrame.current);
    };
  }, []);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    cancelAnimationFrame(inertiaFrame.current);
    inertiaActive.current = false;
    autoResumeAt.current = Number.POSITIVE_INFINITY;
    dragging.current = true;
    setIsDragging(true);
    lastPointer.current = { x: event.clientX, y: event.clientY };
    lastMoveTime.current = performance.now();
    velocity.current = { x: 0, y: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const el = event.currentTarget;
    const now = performance.now();
    const elapsed = Math.max(now - lastMoveTime.current, 1);
    const deltaX = lastPointer.current.x - event.clientX;
    const deltaY = lastPointer.current.y - event.clientY;
    el.scrollLeft += deltaX;
    el.scrollTop += deltaY;
    velocity.current = {
      x: velocity.current.x * 0.6 + (deltaX / elapsed) * 0.4,
      y: velocity.current.y * 0.6 + (deltaY / elapsed) * 0.4,
    };
    lastPointer.current = { x: event.clientX, y: event.clientY };
    lastMoveTime.current = now;
    normalizePosition(el);
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    dragging.current = false;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    startInertia(event.currentTarget);
  }

  function normalizePosition(el: HTMLDivElement) {
    const periodX = el.scrollWidth / 3;
    const periodY = el.scrollHeight / 3;
    if (el.scrollLeft < periodX * 0.5) el.scrollLeft += periodX;
    if (el.scrollLeft > periodX * 1.5) el.scrollLeft -= periodX;
    if (el.scrollTop < periodY * 0.5) el.scrollTop += periodY;
    if (el.scrollTop > periodY * 1.5) el.scrollTop -= periodY;
  }

  function startInertia(el: HTMLDivElement) {
    if (Math.hypot(velocity.current.x, velocity.current.y) < 0.03) {
      autoResumeAt.current = performance.now() + 300;
      return;
    }
    inertiaActive.current = true;
    let previous = performance.now();

    const glide = (now: number) => {
      const elapsed = Math.min(now - previous, 32);
      previous = now;
      el.scrollLeft += velocity.current.x * elapsed;
      el.scrollTop += velocity.current.y * elapsed;
      normalizePosition(el);

      const damping = Math.pow(0.94, elapsed / 16.67);
      velocity.current.x *= damping;
      velocity.current.y *= damping;

      if (Math.hypot(velocity.current.x, velocity.current.y) < 0.015) {
        inertiaActive.current = false;
        autoResumeAt.current = now + 300;
        return;
      }
      inertiaFrame.current = requestAnimationFrame(glide);
    };

    inertiaFrame.current = requestAnimationFrame(glide);
  }

  return (
    <div className="platform-wall" aria-label="支持的平台">
      <div className="platform-intro">
        <h2>支持主流音视频平台</h2>
        <p>粘贴视频链接，即可解析并下载</p>
      </div>
      <div className="platform-fade-frame">
        <div
          ref={scroller}
          className={`platform-scroll${isDragging ? " dragging" : ""}`}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <div className="platform-rows" ref={rowsRef}>
            {[0, 1, 2].map((cycle) => (
              <div className="platform-cycle" key={cycle}>
                {[0, 4, 8, 12, 16, 20].map((offset, rowIndex) => {
                  const row = [...platforms.slice(offset), ...platforms.slice(0, offset)];
                  return (
                    <div className="platform-track" key={offset}>
                      {[0, 1, 2].map((copy) => (
                        <div className="platform-segment" key={copy}>
                          {row.map((platform) => (
                            <div
                              className="platform-card"
                              key={`${cycle}-${rowIndex}-${copy}-${platform.name}`}
                            >
                              <span className="platform-logo">
                                <img src={platform.logo} alt="" draggable={false} />
                              </span>
                              <span>{platform.name}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <i className="platform-fade fade-left" aria-hidden />
        <i className="platform-fade fade-right" aria-hidden />
        <i className="platform-fade fade-top" aria-hidden />
        <i className="platform-fade fade-bottom" aria-hidden />
      </div>
    </div>
  );
}
