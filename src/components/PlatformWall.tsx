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
import { t, type TKey } from "../lib/i18n";

interface PlatformEntry {
  /** 稳定 id：React key 用，避免语言切换影响列表 */
  id: string;
  /** 语言中立名称（品牌原名） */
  name?: string;
  /** 需本地化的名称（走 i18n 键） */
  nameKey?: TKey;
  logo: string;
}

const platforms: PlatformEntry[] = [
  { id: "youtube", name: "YouTube", logo: youtube },
  { id: "bilibili", nameKey: "platform.bilibili", logo: bilibili },
  { id: "tiktok", name: "TikTok", logo: tiktok },
  { id: "xiaohongshu", nameKey: "platform.xiaohongshu", logo: xiaohongshu },
  { id: "instagram", name: "Instagram", logo: instagram },
  { id: "facebook", name: "Facebook", logo: facebook },
  { id: "twitter", name: "Twitter", logo: twitter },
  { id: "x", name: "X", logo: xTwitter },
  { id: "threads", name: "Threads", logo: threads },
  { id: "twitch", name: "Twitch", logo: twitch },
  { id: "vimeo", name: "Vimeo", logo: vimeo },
  { id: "dailymotion", name: "Dailymotion", logo: dailymotion },
  { id: "soundcloud", name: "SoundCloud", logo: soundCloud },
  { id: "spotify", name: "Spotify", logo: spotify },
  { id: "netease", nameKey: "platform.netease", logo: neteaseCloudMusic },
  { id: "suno", name: "Suno", logo: suno },
  { id: "reddit", name: "Reddit", logo: reddit },
  { id: "pinterest", name: "Pinterest", logo: pinterest },
  { id: "snapchat", name: "Snapchat", logo: snapchat },
  { id: "linkedin", name: "LinkedIn", logo: linkedIn },
  { id: "tumblr", name: "Tumblr", logo: tumblr },
  { id: "vk", name: "VK", logo: vk },
  { id: "weibo", nameKey: "platform.weibo", logo: weibo },
  { id: "amazon", name: "Amazon", logo: amazon },
];

function platformLabel(p: PlatformEntry): string {
  if (p.name) return p.name;
  if (p.nameKey) return t(p.nameKey);
  return p.id;
}

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
  const glideOffset = useRef({ x: 0, y: 0 });
  const autoResumeAt = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isGliding, setIsGliding] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const { x, y } = loopSize(el);
    el.scrollLeft = x;
    el.scrollTop = y;
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
        const period = loopSize(el).x;
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
    if (inertiaActive.current) commitGlide(event.currentTarget);
    inertiaActive.current = false;
    setIsGliding(false);
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
    const speed = Math.hypot(velocity.current.x, velocity.current.y);
    const maxSpeed = 1.5;
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      velocity.current.x *= scale;
      velocity.current.y *= scale;
    }
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
    const { x: periodX, y: periodY } = loopSize(el);
    if (el.scrollLeft < periodX * 0.5) el.scrollLeft += periodX;
    if (el.scrollLeft > periodX * 1.5) el.scrollLeft -= periodX;
    if (el.scrollTop < periodY * 0.5) el.scrollTop += periodY;
    if (el.scrollTop > periodY * 1.5) el.scrollTop -= periodY;
  }

  function startInertia(el: HTMLDivElement) {
    if (Math.hypot(velocity.current.x, velocity.current.y) < 0.03) {
      setIsGliding(false);
      autoResumeAt.current = performance.now() + 300;
      return;
    }
    inertiaActive.current = true;
    setIsGliding(true);
    glideOffset.current = { x: 0, y: 0 };
    let previous = performance.now();

    const glide = (now: number) => {
      const elapsed = Math.min(now - previous, 32);
      previous = now;
      const rows = rowsRef.current;
      if (!rows) {
        inertiaActive.current = false;
        setIsGliding(false);
        return;
      }

      glideOffset.current.x -= velocity.current.x * elapsed;
      glideOffset.current.y -= velocity.current.y * elapsed;
      const { x: periodX, y: periodY } = loopSize(el);
      if (glideOffset.current.x <= -periodX) glideOffset.current.x += periodX;
      if (glideOffset.current.x >= periodX) glideOffset.current.x -= periodX;
      if (glideOffset.current.y <= -periodY) glideOffset.current.y += periodY;
      if (glideOffset.current.y >= periodY) glideOffset.current.y -= periodY;
      rows.style.transform = `translate3d(${autoOffset.current + glideOffset.current.x}px, ${glideOffset.current.y}px, 0)`;

      const damping = Math.pow(0.94, elapsed / 16.67);
      velocity.current.x *= damping;
      velocity.current.y *= damping;

      if (Math.hypot(velocity.current.x, velocity.current.y) < 0.015) {
        commitGlide(el);
        inertiaActive.current = false;
        setIsGliding(false);
        autoResumeAt.current = now + 300;
        return;
      }
      inertiaFrame.current = requestAnimationFrame(glide);
    };

    inertiaFrame.current = requestAnimationFrame(glide);
  }

  function commitGlide(el: HTMLDivElement) {
    const periodX = loopSize(el).x;
    autoOffset.current += glideOffset.current.x;
    while (autoOffset.current > 0) autoOffset.current -= periodX;
    while (autoOffset.current <= -periodX) autoOffset.current += periodX;
    el.scrollTop -= glideOffset.current.y;
    normalizePosition(el);
    glideOffset.current = { x: 0, y: 0 };
    if (rowsRef.current) {
      rowsRef.current.style.transform = `translate3d(${autoOffset.current}px, 0, 0)`;
    }
  }

  return (
    <div className="platform-wall" aria-label={t("platform.aria")}>
      <div className="platform-intro">
        <h2>{t("platform.introTitle")}</h2>
        <p>{t("platform.introDesc")}</p>
      </div>
      <div className="platform-fade-frame">
        <div
          ref={scroller}
          className={`platform-scroll${isDragging ? " dragging" : ""}${isGliding ? " gliding" : ""}`}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <div className="platform-rows" ref={rowsRef}>
            {[0, 1, 2].map((cycle) => (
              <div className="platform-cycle" key={cycle}>
                {[0, 4, 8, 12, 16, 20].map((offset, rowIndex) => {
                  const row = Array.from(
                    { length: 8 },
                    (_, index) => platforms[(offset + index) % platforms.length],
                  );
                  return (
                    <div className="platform-track" key={offset}>
                      {[0, 1, 2].map((copy) => (
                        <div className="platform-segment" key={copy}>
                          {row.map((platform) => (
                            <div
                              className="platform-card"
                              key={`${cycle}-${rowIndex}-${copy}-${platform.id}`}
                            >
                              <span className="platform-logo">
                                <img
                                  src={platform.logo}
                                  alt=""
                                  draggable={false}
                                  loading="eager"
                                  decoding="sync"
                                />
                              </span>
                              <span>{platformLabel(platform)}</span>
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

function loopSize(el: HTMLDivElement) {
  const segment = el.querySelector<HTMLElement>(".platform-segment");
  const cycle = el.querySelector<HTMLElement>(".platform-cycle");
  return {
    x: segment?.offsetWidth || el.scrollWidth / 3,
    y: cycle?.offsetHeight || el.scrollHeight / 3,
  };
}
