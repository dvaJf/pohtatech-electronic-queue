/**
 * Audio chime and speech synthesis helper for queue announcements.
 */
/**
  * МОДУЛЬ АУДИО-ОПОВЕЩЕНИЯ И ГОЛОСОВОГО ДИКТОРА АО «ПОЧТА РОССИИ» (СУО 3.0)
  * Обеспечивает:
 *  1. Теплый акустический двухтональный гонг почтового отделения (Web Audio API)
 *     с гармоническим наслоением обертонов и мягким фильтром (lowpass 2600 Гц)
 *  2. Высококачественную русскую вежливую озвучку вызова клиентов:
 *     «Внимание. Клиент с талоном [буква] [число словами]. Пожалуйста, пройдите к окну номер [номер].»
 *  3. Интеллектуальный конвертер чисел в слова (42 -> «сорок два») и фонетику букв (Cyrillic + Latin)
 *  4. Умный ранжировщик естественных нейронных голосов (Google, Apple, Microsoft Natural)
 *  5. Единое управление состоянием звука (localStorage + события для интерфейса)
  */

export interface AnnouncementOptions {
  soundEnabled?: boolean;
  voiceEnabled?: boolean;
  speechRate?: number;
  speechPitch?: number;
  selectedVoiceName?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

export interface AnnouncementData {
  phrase: string;
  displayText: string;
  phoneticTicket: string;
  windowPhrase: string;
  ticketNumber: string;
  windowId: number | string;
}

const SOUND_STORAGE_KEY = 'pochta_sound_enabled';

/**
 * Проверка включен ли звук в системе (по умолчанию включен)
 */
export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(SOUND_STORAGE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

/**
 * Переключение звука в системе с сохранением в localStorage и оповещением слушателей
 */
export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent('pochta:sound', { detail: { enabled } }));
    if (enabled) {
      // Воспроизводим мягкий подтверждающий гонг для проверки и разблокировки AudioContext
      void playPostalChime(0.20);
    }
  } catch {}
}

/**
 * Глобальный синглтон AudioContext для предотвращения превышения лимита контекстов браузера
 */
let sharedAudioContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextClass) return null;

  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    try {
      sharedAudioContext = new AudioContextClass();
    } catch (e) {
      console.warn('Failed to create AudioContext:', e);
    }
  }

  if (sharedAudioContext && sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }

  return sharedAudioContext;
}

// Автоматическая разблокировка звука при первом пользовательском взаимодействии (Autoplay Policy)
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getSharedAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      if ('speechSynthesis' in window) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }
    } catch {}
  };

  ['click', 'touchstart', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { passive: true });
  });
}

/**
 * Преобразование целого числа (0..999 999) в естественную русскую словесную форму
 * Предотвращает роботизированное «четыре два» или «ноль сорок два»
 */
export function numberToRussianWords(n: number): string {
  if (isNaN(n)) return '';
  if (n === 0) return 'ноль';
  if (n < 0) return 'минус ' + numberToRussianWords(-n);

  const unitsM = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const unitsF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = [
    'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
    'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'
  ];
  const tens = [
    '', '', 'двадцать', 'тридцать', 'сорок',
    'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'
  ];
  const hundreds = [
    '', 'сто', 'двести', 'триста', 'четыреста',
    'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'
  ];

  function convertHundreds(num: number, isFemale: boolean): string[] {
    const res: string[] = [];
    const h = Math.floor(num / 100);
    const rem = num % 100;
    const t = Math.floor(rem / 10);
    const u = rem % 10;

    if (h > 0 && h <= 9) res.push(hundreds[h]);
    if (rem >= 10 && rem <= 19) {
      res.push(teens[rem - 10]);
    } else {
      if (t >= 2) res.push(tens[t]);
      const unitWords = isFemale ? unitsF : unitsM;
      if (u > 0) res.push(unitWords[u]);
    }
    return res;
  }

  const parts: string[] = [];
  const thousands = Math.floor(n / 1000);
  const remainder = n % 1000;

  if (thousands > 0) {
    parts.push(...convertHundreds(thousands, true));
    const tRem = thousands % 100;
    const tLast = thousands % 10;
    if (tRem >= 11 && tRem <= 19) {
      parts.push('тысяч');
    } else if (tLast === 1) {
      parts.push('тысяча');
    } else if (tLast >= 2 && tLast <= 4) {
      parts.push('тысячи');
    } else {
      parts.push('тысяч');
    }
  }

  if (remainder > 0 || thousands === 0) {
    parts.push(...convertHundreds(remainder, false));
  }

  return parts.join(' ');
}

/**
 * Аутентичный теплый двухтональный гонг почтового отделения связи (Web Audio API)
 * 1-й тон: Ре (587.33 Гц) -> 2-й тон: Ля (880.00 Гц)
 * С гармоническим наслоением обертонов, мягкой атакой (anti-click) и фильтром 2600 Гц
 */
export function playPostalChime(volume: number = 0.28): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    try {
      const ctx = getSharedAudioContext();
      if (!ctx) {
        resolve();
        return;
      }

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;

      // Мягкий мастер-фильтр низких частот (2600 Гц) для теплого бархатного звучания
      const masterFilter = ctx.createBiquadFilter();
      masterFilter.type = 'lowpass';
      masterFilter.frequency.setValueAtTime(2600, now);
      masterFilter.Q.setValueAtTime(0.7, now);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(volume, now);

      masterFilter.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Генератор акустического тона с мягкой атакой и гармоническим обертоном
      const playHarmonicTone = (freq: number, startTime: number, duration: number, gainLevel: number) => {
        // Фундаментальный тон (sine)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, startTime);

        // Мягкая атака (15 мс) исключает цифровой клик динамика
        gain1.gain.setValueAtTime(0.0001, startTime);
        gain1.gain.linearRampToValueAtTime(gainLevel, startTime + 0.015);
        gain1.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        osc1.connect(gain1);
        gain1.connect(masterFilter);
        osc1.start(startTime);
        osc1.stop(startTime + duration + 0.05);

        // Вторая гармоника (октава вверх) для акустической чистоты
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, startTime);

        gain2.gain.setValueAtTime(0.0001, startTime);
        gain2.gain.linearRampToValueAtTime(gainLevel * 0.25, startTime + 0.012);
        gain2.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.65);

        osc2.connect(gain2);
        gain2.connect(masterFilter);
        osc2.start(startTime);
        osc2.stop(startTime + duration * 0.7);
      };

      // Тон 1: Ре (D5 = 587.33 Гц)
      playHarmonicTone(587.33, now, 0.65, 0.9);

      // Тон 2: Ля (A5 = 880.00 Гц) — вступает на 240 мс
      playHarmonicTone(880.00, now + 0.24, 1.05, 1.0);

      // Тактильная виброотдача для мобильных устройств
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate([120, 70, 130]);
        } catch {}
      }

      // Разрешаем промис чуть раньше затухания, чтобы речь диктора плавно следовала за гонгом
      setTimeout(resolve, 650);
    } catch (err) {
      console.warn('Audio chime failed:', err);
      resolve();
    }
  });
}

/**
 * Преобразование серии талона и номера в естественное звучание на русском языке
 */
export function formatAnnouncementPhrase(
  ticketNumber: string,
  windowId: number | string
): AnnouncementData {
  const cleanTicket = (ticketNumber || '').trim();
  let phoneticTicket = cleanTicket;

  const letterPronunciations: Record<string, string> = {
    // Кириллические буквы
    'А': 'А',
    'Б': 'Бэ',
    'В': 'Вэ',
    'Г': 'Гэ',
    'Д': 'Дэ',
    'Е': 'Е',
    'Ж': 'Жэ',
    'З': 'Зэ',
    'И': 'И',
    'К': 'Ка',
    'Л': 'Эль',
    'М': 'Эм',
    'Н': 'Эн',
    'О': 'О',
    'П': 'Пэ',
    'Р': 'Эр',
    'С': 'Эс',
    'Т': 'Тэ',
    'У': 'У',
    'Ф': 'Эф',
    'Х': 'Ха',
    'Ц': 'Цэ',
    'Ч': 'Че',
    'Ш': 'Ша',
    'Щ': 'Ща',
    'Э': 'Э',
    'Ю': 'Ю',
    'Я': 'Я',
    // Латинские буквы (встречаются в сериях Q-000001, A-000001, L-000001)
    'A': 'А',
    'B': 'Бэ',
    'C': 'Цэ',
    'D': 'Дэ',
    'E': 'Е',
    'F': 'Эф',
    'G': 'Джи',
    'H': 'Аш',
    'I': 'И',
    'J': 'Джей',
    'K': 'Ка',
    'L': 'Эль',
    'M': 'Эм',
    'N': 'Эн',
    'O': 'О',
    'P': 'Пэ',
    'Q': 'Ку',
    'R': 'Эр',
    'S': 'Эс',
    'T': 'Тэ',
    'U': 'У',
    'V': 'Вэ',
    'W': 'Дубль-вэ',
    'X': 'Икс',
    'Y': 'Игрек',
    'Z': 'Зет'
  };

  // Парсинг талона (поддерживает Q-000042, A-000015, L-000123, А042, О031, П015)
  let letter = '';
  let numInt: number | null = null;

  const match = cleanTicket.match(/^([A-Za-zА-Яа-яЁё]+)[-\s]?([0-9]+)$/);
  if (match) {
    letter = match[1].toUpperCase();
    numInt = parseInt(match[2], 10);
  } else {
    const parts = cleanTicket.split('-');
    if (parts.length === 2) {
      letter = parts[0].trim().toUpperCase();
      numInt = parseInt(parts[1], 10);
    }
  }

  if (letter && numInt !== null && !isNaN(numInt)) {
    const letterSpoken = letterPronunciations[letter] || letter;
    const numSpoken = numberToRussianWords(numInt);
    phoneticTicket = `${letterSpoken}, ${numSpoken}`;
  }

  const windowNames: Record<string, string> = {
    '1': 'один',
    '2': 'два',
    '3': 'три',
    '4': 'четыре',
    '5': 'пять',
    '6': 'шесть',
    '7': 'семь',
    '8': 'восемь',
    '9': 'девять',
    '10': 'десять'
  };

  const windowStr = String(windowId).trim();
  const windowPhrase = windowNames[windowStr] || (!isNaN(Number(windowStr)) ? numberToRussianWords(Number(windowStr)) : windowStr);

  // Вежливая, плавная и благозвучная фраза по современному регламенту Почты России
  // Знаки препинания (точки, запятые) обеспечивают естественные дыхательные паузы синтезатора
  const phrase = `Внимание. Клиент с талоном ${phoneticTicket}. Пожалуйста, пройдите к окну номер ${windowPhrase}.`;
  const displayText = `Клиент с талоном ${cleanTicket} → Окно № ${windowId}`;

  return {
    phrase,
    displayText,
    phoneticTicket,
    windowPhrase,
    ticketNumber: cleanTicket,
    windowId
  };
}

let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesInitialized = false;

export function initSpeechVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (voicesInitialized) return;
  voicesInitialized = true;

  const update = () => {
    try {
      const list = window.speechSynthesis.getVoices();
      if (list && list.length > 0) {
        cachedVoices = list;
      }
    } catch {}
  };

  update();
  try {
    if (window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener('voiceschanged', update);
    } else if ('onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = update;
    }
  } catch {}
}

if (typeof window !== 'undefined') {
  initSpeechVoices();
}

/**
 * Разблокировка Web Audio и SpeechSynthesis в контексте пользовательского жеста
 */
export function unlockSpeechSynthesis(): void {
  if (typeof window === 'undefined') return;
  try {
    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if ('speechSynthesis' in window) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      const silent = new SpeechSynthesisUtterance('');
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
    }
  } catch {}
}

/**
 * Получение установленных в системе русских голосов с ранжированием по естественности
 * Приоритет отдается нейронным, Google, Apple Siri, Microsoft Natural и женским голосам
 */
export function getRussianSpeechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  let voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0 && cachedVoices.length > 0) {
    voices = cachedVoices;
  }
  const ruVoices = voices.filter(
    (v) =>
      v.lang.toLowerCase().startsWith('ru') ||
      v.lang.toLowerCase().includes('rus') ||
      v.name.toLowerCase().includes('russian') ||
      v.name.toLowerCase().includes('рус')
  );

  if (ruVoices.length === 0) {
    // Если русских голосов не найдено, возвращаем все доступные (дефолтный голос браузера первым)
    const defaultVoice = voices.find(v => v.default) || voices[0];
    return defaultVoice ? [defaultVoice, ...voices.filter(v => v !== defaultVoice)] : voices;
  }

  const rateVoice = (voice: SpeechSynthesisVoice): number => {
    const name = (voice.name || '').toLowerCase();
    let score = 50;

    // Премиальные нейросетевые голоса
    if (name.includes('natural')) score += 60;
    if (name.includes('neural')) score += 55;
    if (name.includes('online')) score += 35;
    if (name.includes('enhanced') || name.includes('premium')) score += 40;

    // Фирменные качественные движки
    if (name.includes('google')) score += 45; // Google русский — мягкий, разборчивый
    if (name.includes('yandex')) score += 45; // Яндекс Алиса / диктор
    if (name.includes('milena') || name.includes('katya') || name.includes('yuri')) score += 40; // Apple voices
    if (name.includes('svetlana') || name.includes('daria') || name.includes('irina')) score += 35; // Windows Natural

    // Женские голоса звучат теплее и отчетливее в публичных залах
    if (
      name.includes('female') ||
      name.includes('жен') ||
      name.includes('svetlana') ||
      name.includes('daria') ||
      name.includes('milena') ||
      name.includes('elena') ||
      name.includes('irina') ||
      name.includes('tatyana') ||
      name.includes('victoria')
    ) {
      score += 20;
    }

    // Удаленный сервис обычно выше качеством, чем примитивный локальный синтезатор
    if (!voice.localService) score += 15;

    // Понижаем роботизированный eSpeak/speech-dispatcher
    if (name.includes('espeak') || name.includes('speech-dispatcher') || name.includes('synth')) {
      score -= 50;
    }

    return score;
  };

  return ruVoices.sort((a, b) => rateVoice(b) - rateVoice(a));
}

/**
 * Комплексное воспроизведение вызова клиента: гонг + вежливый диктор на русском языке
 */
export async function announceTicketCall(
  ticketNumber: string,
  windowId: number | string,
  options?: AnnouncementOptions
): Promise<AnnouncementData> {
  const masterSound = isSoundEnabled();
  const {
    soundEnabled = masterSound,
    voiceEnabled = masterSound,
    speechRate = 0.88, // Спокойный темп речи диктора
    speechPitch = 1.03, // Мягкий и благозвучный тембр
    selectedVoiceName,
    onStart,
    onEnd
  } = options || {};

  const announcementData = formatAnnouncementPhrase(ticketNumber, windowId);

  // 1. Проигрываем двухтональный гармонический гонг
  if (soundEnabled) {
    await playPostalChime(0.28);
  }

  // 2. Озвучиваем диктором через Web Speech API
  if (voiceEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return new Promise((resolve) => {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }

        const utterance = new SpeechSynthesisUtterance(announcementData.phrase);
        utterance.lang = 'ru-RU';
        utterance.rate = speechRate;
        utterance.pitch = speechPitch;

        const rankedVoices = getRussianSpeechVoices();
        if (selectedVoiceName) {
          const match = rankedVoices.find((v) => v.name === selectedVoiceName);
          if (match) utterance.voice = match;
        }

        if (!utterance.voice && rankedVoices.length > 0) {
          utterance.voice = rankedVoices[0];
        }

        let isFinished = false;
        let timeout: ReturnType<typeof setTimeout>;
        const handleFinish = () => {
          if (!isFinished) {
            isFinished = true;
            clearTimeout(timeout);
            if (onEnd) onEnd();
            resolve(announcementData);
          }
        };

        utterance.onstart = () => {
          if (onStart) onStart();
        };

        utterance.onend = handleFinish;
        utterance.onerror = (e) => {
          console.warn('Speech synthesis utterance error:', e);
          handleFinish();
        };

        // Небольшая задержка перед речью после гонга
        setTimeout(() => {
          try {
            if (window.speechSynthesis.paused) {
              window.speechSynthesis.resume();
            }
            window.speechSynthesis.speak(utterance);
          } catch (speakErr) {
            console.warn('Failed to speak utterance:', speakErr);
            handleFinish();
          }
        }, 50);

        // Страховочный таймаут (если синтез зависнет в браузере)
        timeout = setTimeout(() => {
          handleFinish();
        }, 8000);
      } catch (err) {
        console.warn('Speech synthesis exception:', err);
        if (onEnd) onEnd();
        resolve(announcementData);
      }
    });
  } else {
    if (onStart) onStart();
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        if (onEnd) onEnd();
        resolve();
      }, 1000)
    );
    return announcementData;
  }
}
