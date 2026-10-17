/*
 * Voz: grava o microfone, converte para WAV 16 kHz mono (formato que o Gemini aceita em qualquer
 * navegador, inclusive o Safari do iPhone) e lê respostas em voz alta (speechSynthesis, offline).
 * As funções puras (downsample, encodeWav, toBase64) não dependem do navegador e são testáveis no Node.
 */
(function (g) {
  'use strict';
  const TARGET_RATE = 16000;

  class VoiceError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // ---- Funções puras ---------------------------------------------------------
  /** Reduz a taxa de amostragem fazendo a média de cada janela (filtro simples contra chiado). */
  function downsample(input, inRate, outRate) {
    if (outRate >= inRate) return input;
    const ratio = inRate / outRate;
    const n = Math.floor(input.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = a; j < b; j++) sum += input[j];
      out[i] = sum / Math.max(1, b - a);
    }
    return out;
  }

  /** Sobe o volume de gravações baixas (até 6x), sem estourar. Retorna o pico original. */
  function normalizePeak(samples, maxGain = 6, target = 0.9) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    const gain = peak > 0 ? Math.min(maxGain, target / peak) : 1;
    if (gain > 1.05) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    return peak;
  }

  /** WAV PCM 16-bit mono. */
  function encodeWav(samples, rate) {
    const dataLen = samples.length * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const v = new DataView(buf);
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    v.setUint32(4, 36 + dataLen, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, dataLen, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const supported = () =>
    typeof navigator !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
    !!(g.AudioContext || g.webkitAudioContext);

  function mapError(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return new VoiceError('denied', 'O microfone está bloqueado. Libere o acesso nas configurações do navegador (ou do app) e tente de novo.');
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return new VoiceError('nodevice', 'Não encontrei um microfone neste aparelho.');
    if (n === 'NotReadableError') return new VoiceError('busy', 'O microfone está sendo usado por outro app. Feche-o e tente de novo.');
    return new VoiceError('error', 'Não consegui acessar o microfone.');
  }

  // ---- Gravador ----------------------------------------------------------------
  class Recorder {
    /**
     * o = { silenceMs, maxMs, minSpeechMs, onTick(ms), onAutoStop(motivo) }
     * Leia `level` (0..1) a cada quadro para animar a onda.
     */
    constructor(o = {}) {
      this.o = { silenceMs: 3500, maxMs: 120000, minSpeechMs: 500, ...o };
      this.chunks = [];
      this.level = 0;
      this.speechMs = 0;
      this.floor = null;
      this.cancelled = false;
      this.fired = false;
    }

    async start() {
      if (!supported()) throw new VoiceError('unsupported', 'Este navegador não permite gravar áudio aqui. Use o campo de texto.');
      const AC = g.AudioContext || g.webkitAudioContext;
      this.ctx = new AC(); // criado dentro do toque do usuário (exigência do iPhone)
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        this._cleanup();
        throw mapError(e);
      }
      if (this.cancelled) {
        this._cleanup();
        throw new VoiceError('aborted', 'Cancelado.');
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      this.rate = this.ctx.sampleRate;
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.proc = this.ctx.createScriptProcessor(4096, 1, 1); // antigo, mas funciona em todos os navegadores
      this.proc.onaudioprocess = (ev) => this._onAudio(ev.inputBuffer.getChannelData(0));
      this.src.connect(this.proc);
      this.proc.connect(this.ctx.destination); // saída fica muda; sem isto o nó não dispara
      this.t0 = performance.now();
      this.lastVoice = this.t0;
      this.timer = setInterval(() => this._tick(), 120);
    }

    _onAudio(ch) {
      this.chunks.push(new Float32Array(ch));
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      const rms = Math.sqrt(sum / ch.length);
      // piso de ruído: acompanha o mínimo recente e sobe devagar
      this.floor = this.floor == null ? rms : Math.min(this.floor * 1.002 + 1e-6, rms);
      const loud = rms > Math.max(0.012, this.floor * 3);
      if (loud) {
        this.speechMs += (ch.length / this.rate) * 1000;
        this.lastVoice = performance.now();
      }
      this.level = this.level * 0.6 + Math.min(1, rms * 10) * 0.4;
    }

    _tick() {
      const now = performance.now();
      const ms = now - this.t0;
      if (this.o.onTick) this.o.onTick(ms);
      if (this.fired) return;
      let why = '';
      if (ms >= this.o.maxMs) why = 'max';
      else if (this.speechMs >= this.o.minSpeechMs && now - this.lastVoice > this.o.silenceMs) why = 'silencio';
      if (why) {
        this.fired = true;
        if (this.o.onAutoStop) this.o.onAutoStop(why);
      }
    }

    /** Para e devolve o áudio pronto para enviar: { b64, mime, blob, seconds, speechMs }. */
    stop() {
      const rate = this.rate || TARGET_RATE;
      this._cleanup();
      const total = this.chunks.reduce((a, c) => a + c.length, 0);
      const all = new Float32Array(total);
      let off = 0;
      for (const c of this.chunks) {
        all.set(c, off);
        off += c.length;
      }
      this.chunks = [];
      const out = downsample(all, rate, TARGET_RATE);
      const outRate = Math.min(rate, TARGET_RATE);
      const peak = normalizePeak(out);
      const bytes = encodeWav(out, outRate);
      return {
        b64: toBase64(bytes),
        mime: 'audio/wav',
        blob: new Blob([bytes], { type: 'audio/wav' }),
        seconds: out.length / outRate,
        speechMs: this.speechMs,
        peak,
      };
    }

    cancel() {
      this.cancelled = true;
      this._cleanup();
      this.chunks = [];
    }

    _cleanup() {
      clearInterval(this.timer);
      this.timer = null;
      try {
        if (this.proc) {
          this.proc.onaudioprocess = null;
          this.proc.disconnect();
        }
        if (this.src) this.src.disconnect();
      } catch (e) {
        /* ignore */
      }
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx && this.ctx.state !== 'closed') this.ctx.close().catch(() => {});
      this.proc = this.src = this.stream = null;
    }
  }

  // ---- Fala (resposta em voz alta) ----------------------------------------------
  const canSpeak = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  function speak(text) {
    if (!canSpeak() || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'pt-BR';
      const voice = speechSynthesis.getVoices().find((v) => /^pt[-_]BR/i.test(v.lang));
      if (voice) u.voice = voice;
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch (e) {
      /* ignore */
    }
  }
  const stopSpeaking = () => {
    try {
      if (canSpeak()) speechSynthesis.cancel();
    } catch (e) {
      /* ignore */
    }
  };

  g.Voice = { Recorder, VoiceError, supported, canSpeak, speak, stopSpeaking, downsample, normalizePeak, encodeWav, toBase64, TARGET_RATE };
})(typeof window !== 'undefined' ? window : globalThis);
