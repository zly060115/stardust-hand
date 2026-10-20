# -*- coding: utf-8 -*-
"""
record/make_audio.py —— 生成宣传片配乐（纯合成，无素材）

声音节点和画面时间轴一一对齐：
  2.4   手入画        4.35 张开        6.7  握拳
  9.55  再张开        13.5 捏合爆发    15.3-17.75 画心（铃）
  18.3-23.0 写字（铃） 24.15 响指（裂响+下坠） 27.5 片尾和声
输出：record/soundtrack.wav（31.2s，44.1kHz 立体声）
"""
import numpy as np
import wave

SR = 44100
DUR = 31.2
N = int(SR * DUR)
rng = np.random.default_rng(20261020)

L = np.zeros(N)
R = np.zeros(N)


def add(sig, at, gain=1.0, pan=0.0):
    """把一段声波叠进总线；pan -1..1"""
    i0 = int(at * SR)
    n = min(len(sig), N - i0)
    if n <= 0:
        return
    seg = sig[:n] * gain
    lg = min(1.0, 1.0 - pan)
    rg = min(1.0, 1.0 + pan)
    L[i0:i0 + n] += seg * lg
    R[i0:i0 + n] += seg * rg


def env_ar(n, a, r, hold=1.0):
    """attack-release 包络"""
    e = np.ones(n) * hold
    na, nr = int(a * SR), int(r * SR)
    na, nr = min(na, n), min(nr, n)
    if na > 0:
        e[:na] *= np.linspace(0, 1, na)
    if nr > 0:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def tone(f0, f1, dur, vol=1.0, harmonic2=0.0):
    """正弦滑音 + 可选二次谐波"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    freq = np.geomspace(max(f0, 1), max(f1, 1), n)
    ph = 2 * np.pi * np.cumsum(freq) / SR
    s = np.sin(ph)
    if harmonic2 > 0:
        s += harmonic2 * np.sin(2 * ph)
    return s * env_ar(n, min(0.02, dur * 0.15), dur * 0.75) * vol


def bell(freq, dur=1.6, vol=1.0):
    """风铃：基频 + 非整数泛音，指数衰减"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * freq * t)
         + 0.45 * np.sin(2 * np.pi * freq * 2.01 * t)
         + 0.18 * np.sin(2 * np.pi * freq * 2.98 * t))
    return s * np.exp(-t / (dur * 0.32)) * vol


def shaped_noise(dur, lo, hi, vol=1.0):
    """FFT 频域带通的噪声"""
    n = int(dur * SR)
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    lo_s, hi_s = max(lo * 0.18, 8), max(hi * 0.18, 8)
    mask = 1 / (1 + np.exp(-(f - lo) / lo_s))
    mask *= 1 / (1 + np.exp((f - hi) / hi_s))
    y = np.fft.irfft(X * mask, n)
    y /= (np.abs(y).max() + 1e-9)
    return y * vol


def noise_hit(dur, lo, hi, attack, decay_tau, vol=1.0):
    x = shaped_noise(dur, lo, hi)
    t = np.arange(len(x)) / SR
    e = np.exp(-t / decay_tau)
    na = int(attack * SR)
    if na > 0:
        e[:na] *= np.linspace(0, 1, na)
    return x * e * vol


# ---------- 底噪：和程序里一样的三振荡器 drone，带极慢呼吸 ----------
drone_t = np.arange(N) / SR
lfo = 0.72 + 0.28 * np.sin(2 * np.pi * 0.055 * drone_t)
droneL = (np.sin(2 * np.pi * 55.0 * drone_t) * 0.62
          + np.sin(2 * np.pi * 82.5 * drone_t + 0.7) * 0.34
          + np.sin(2 * np.pi * 110.3 * drone_t + 1.3) * 0.16)
droneR = (np.sin(2 * np.pi * 55.15 * drone_t) * 0.62
          + np.sin(2 * np.pi * 82.35 * drone_t + 2.1) * 0.34
          + np.sin(2 * np.pi * 110.6 * drone_t + 0.4) * 0.16)
L += droneL * lfo * 0.055
R += droneR * lfo * 0.055

# ---------- 2.4 手入画：轻柔上扬的气声 ----------
add(noise_hit(1.4, 500, 3800, 0.5, 0.5), 2.35, 0.16)

# ---------- 4.35 张开：上行 + 一声铃 ----------
add(tone(300, 880, 0.9, 0.10), 4.3)
add(bell(880, 2.2, 0.16), 4.5, pan=-0.3)
add(bell(1318.5, 2.2, 0.11), 4.72, pan=0.35)

# ---------- 6.7 握拳：下沉 ----------
add(tone(430, 70, 1.7, 0.16), 6.68)
add(noise_hit(1.2, 120, 900, 0.35, 0.45), 6.68, 0.10)

# ---------- 9.55 再张开 ----------
add(tone(260, 950, 1.0, 0.10), 9.52)
add(bell(1108.7, 2.0, 0.10), 9.9, pan=0.25)

# ---------- 13.5 捏合：掌心超新星 ----------
add(tone(150, 30, 1.5, 0.30), 13.5)
add(noise_hit(0.8, 90, 1400, 0.01, 0.25), 13.5, 0.20)
add(bell(659.25, 2.4, 0.08), 13.62, pan=-0.2)

# ---------- 画心：一串上行风铃 ----------
HEART_BELLS = [
    (15.45, 659.25), (15.95, 880.0), (16.45, 987.77),
    (17.0, 1108.73), (17.5, 1318.51),
]
for at, f in HEART_BELLS:
    add(bell(f, 2.0, 0.13), at, pan=rng.uniform(-0.4, 0.4))

# 心成形：轻轻的两声
add(bell(880, 2.4, 0.10), 17.95)
add(bell(1318.51, 2.6, 0.08), 18.1)

# ---------- 写字母：更轻的铃 ----------
LETTER_BELLS = [
    (18.4, 659.25), (20.0, 880.0), (20.75, 987.77),
    (21.6, 1108.73), (22.5, 1318.51),
]
for at, f in LETTER_BELLS:
    add(bell(f, 1.7, 0.085), at, pan=rng.uniform(-0.35, 0.35))

# ---------- 24.15 响指：裂响 + 下坠轰鸣 + 长尾 ----------
add(noise_hit(0.10, 2800, 9500, 0.002, 0.028), 24.15, 0.52)      # 那声"啪"
add(tone(120, 26, 2.1, 0.34), 24.16)                             # 下坠
add(noise_hit(1.6, 150, 5200, 0.01, 0.5), 24.16, 0.20)           # 冲击气浪
add(bell(220, 3.4, 0.10), 24.5, pan=0.2)
add(bell(329.63, 3.6, 0.08), 24.75, pan=-0.25)

# ---------- 27.5 片尾：温暖的 A 和弦垫 ----------
pad_notes = [220.0, 277.18, 329.63, 440.0]
for i, f in enumerate(pad_notes):
    n = int(3.6 * SR)
    tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * tt) * env_ar(n, 1.6, 1.6)
    add(s, 27.5 + i * 0.12, 0.055, pan=(-0.3 + 0.2 * i))

# ---------- 简单混响：多抽头延迟 ----------
wetL = np.zeros(N)
wetR = np.zeros(N)
for d, g in [(0.031, 0.30), (0.047, 0.24), (0.061, 0.19), (0.089, 0.15), (0.127, 0.10)]:
    d0 = int(d * SR)
    wetL[d0:] += L[:-d0] * g
    wetR[d0:] += R[:-d0] * g
L += wetL * 0.55
R += wetR * 0.55

# ---------- 总线：淡入淡出 + 软限幅 ----------
fade_in = np.clip(np.arange(N) / (1.1 * SR), 0, 1)
fade_out = np.clip((DUR - drone_t) / 1.0, 0, 1)
master = fade_in * fade_out
L *= master
R *= master

peak = max(np.abs(L).max(), np.abs(R).max())
L = np.tanh(L / peak * 1.6) / np.tanh(1.6) * 0.88
R = np.tanh(R / peak * 1.6) / np.tanh(1.6) * 0.88

data = np.empty(N * 2, dtype=np.int16)
data[0::2] = (L * 32767).astype(np.int16)
data[1::2] = (R * 32767).astype(np.int16)

with wave.open('record/soundtrack.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())

print(f'soundtrack.wav 写好了：{DUR}s，峰值 {peak:.3f}')
