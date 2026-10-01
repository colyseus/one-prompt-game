import { FLOOR, type Dungeon } from "../shared/dungeon.js";
import { SEAT_COLORS } from "./render/heroView.js";

export interface PartyMember {
  sessionId: string;
  name: string;
  seat: number;
  kills: number;
  connected: boolean;
  isSelf: boolean;
}

export interface MapDot { x: number; y: number; color: string; size: number; }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** The HTML overlay: floor, shared hearts, objective, party list, banners, minimap. */
export class Hud {
  private readonly floorEl = $("floor");
  private readonly livesEl = $("lives");
  private readonly objectiveEl = $("objective");
  private readonly partyEl = $("party");
  private readonly bannerEl = $("banner");
  private readonly toastEl = $("toast");
  private readonly statusEl = $("status");
  private readonly minimap = $<HTMLCanvasElement>("minimap");
  private readonly tiles = document.createElement("canvas");

  private lives = -1;
  private partyKey = "";
  private objectiveKey = "";
  private bannerTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private scale = 4;

  setFloor(floor: number) {
    this.floorEl.textContent = String(floor);
  }

  setLives(lives: number) {
    if (lives === this.lives) { return; }
    const lost = this.lives > lives;
    this.lives = lives;
    this.livesEl.innerHTML = "";
    for (let i = 0; i < lives; i++) {
      const heart = document.createElement("span");
      heart.className = "heart";
      heart.textContent = "♥";
      this.livesEl.appendChild(heart);
    }
    if (lost) {
      const broken = document.createElement("span");
      broken.className = "heart lost";
      broken.textContent = "♥";
      this.livesEl.appendChild(broken);
      setTimeout(() => broken.remove(), 600);
    }
  }

  setObjective(keyTaken: boolean, stairsOpen: boolean, slimesLeft: number) {
    const key = `${keyTaken}|${stairsOpen}|${slimesLeft}`;
    if (key === this.objectiveKey) { return; }
    this.objectiveKey = key;
    this.objectiveEl.classList.toggle("open", stairsOpen);
    this.objectiveEl.textContent = stairsOpen
      ? "✨ The stairs are open — head down!"
      : `🗝️ Find the key, or clear the floor (${slimesLeft} slime${slimesLeft === 1 ? "" : "s"} left)`;
  }

  setParty(members: PartyMember[]) {
    const key = members.map((m) => `${m.sessionId}${m.kills}${m.connected}`).join("|");
    if (key === this.partyKey) { return; }
    this.partyKey = key;
    this.partyEl.innerHTML = "";
    for (const m of members) {
      const row = document.createElement("div");
      row.className = `member${m.connected ? "" : " away"}${m.isSelf ? " self" : ""}`;
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = SEAT_COLORS[m.seat % SEAT_COLORS.length];
      const name = document.createElement("span");
      name.textContent = `${m.name}${m.isSelf ? " (you)" : ""}${m.connected ? "" : " · reconnecting"}`;
      const kills = document.createElement("span");
      kills.className = "kills";
      kills.textContent = `${m.kills} 🫧`;
      row.append(dot, name, kills);
      this.partyEl.appendChild(row);
    }
  }

  banner(title: string, subtitle = "", ms = 2200) {
    this.bannerEl.innerHTML = "";
    const h = document.createElement("div");
    h.className = "title";
    h.textContent = title;
    this.bannerEl.appendChild(h);
    if (subtitle) {
      const p = document.createElement("div");
      p.className = "subtitle";
      p.textContent = subtitle;
      this.bannerEl.appendChild(p);
    }
    this.bannerEl.classList.add("show");
    clearTimeout(this.bannerTimer);
    if (ms > 0) { this.bannerTimer = setTimeout(() => this.bannerEl.classList.remove("show"), ms); }
  }

  hideBanner() {
    clearTimeout(this.bannerTimer);
    this.bannerEl.classList.remove("show");
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), 2400);
  }

  /** A blocking status line (connecting, reconnecting…); `null` hides it. */
  setStatus(text: string | null, action?: { label: string; run: () => void }) {
    this.statusEl.classList.toggle("show", text !== null);
    this.statusEl.innerHTML = "";
    if (text === null) { return; }
    const p = document.createElement("p");
    p.textContent = text;
    this.statusEl.appendChild(p);
    if (action) {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.onclick = action.run;
      this.statusEl.appendChild(button);
    }
  }

  /** Pre-render the floor's tiles; dots are drawn over it each frame. */
  buildMinimap(d: Dungeon) {
    this.scale = Math.max(2, Math.floor(180 / Math.max(d.width, d.height)));
    this.tiles.width = this.minimap.width = d.width * this.scale;
    this.tiles.height = this.minimap.height = d.height * this.scale;
    const g = this.tiles.getContext("2d")!;
    g.clearRect(0, 0, this.tiles.width, this.tiles.height);
    g.fillStyle = "rgba(240, 228, 255, 0.85)";
    for (let y = 0; y < d.height; y++) {
      for (let x = 0; x < d.width; x++) {
        if (d.tiles[y * d.width + x] === FLOOR) { g.fillRect(x * this.scale, y * this.scale, this.scale, this.scale); }
      }
    }
  }

  drawMinimap(dots: MapDot[]) {
    const g = this.minimap.getContext("2d")!;
    g.clearRect(0, 0, this.minimap.width, this.minimap.height);
    g.drawImage(this.tiles, 0, 0);
    for (const dot of dots) {
      g.fillStyle = dot.color;
      g.beginPath();
      g.arc(dot.x * this.scale, dot.y * this.scale, dot.size * this.scale, 0, Math.PI * 2);
      g.fill();
    }
  }
}
