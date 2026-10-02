import os
import re
import json
import time
import datetime
import uuid
import logging
from typing import List, Dict, Any, Optional, AsyncGenerator
import httpx
from knowledge_base import KnowledgeBase
from tools import backend_client

logger = logging.getLogger("rag_agent.agent")

def _load_env():
    for rel_path in [".env", "../.env", "../../.env"]:
        p = os.path.abspath(os.path.join(os.path.dirname(__file__), rel_path))
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k, v = k.strip(), v.strip().strip("'\"")
                            if k and (k not in os.environ or not os.environ[k]):
                                os.environ[k] = v
            except Exception:
                pass

_load_env()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Sber GigaChat Configuration
GIGACHAT_CREDENTIALS = os.getenv("GIGACHAT_CREDENTIALS", "")
GIGACHAT_SCOPE = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
GIGACHAT_MODEL = os.getenv("GIGACHAT_MODEL", "GigaChat")

SYSTEM_PROMPT = """Ты — интеллектуальный цифровой ассистент «Почты России». Твоя цель — вежливо, точно и оперативно помогать клиентам с услугами, правилами, талонами, сайтом и электронной очередью.

Ты обладаешь полными знаниями обо всей веб-платформе «Почты России»:
1. **Главная страница**: взятие талона в живую очередь в 1 клик, предварительная онлайн-запись на конкретное время (с шагом 15-20 мин), отображение нагрузки отделений в реальном времени (людей в очереди, активных окон, расчетного времени ожидания).
2. **Личный кабинет и раздел «Мои талоны»**: автоматическая привязка и хранение всех талонов пользователя, отображение активных талонов, текущей позиции в очереди, таймера ETA, номера вызывающего окна, возможность отменить талон в 1 клик.
3. **Интерактивная карта отделений и Умная маршрутизация (Smart Routing)**:
   - Расчет наилучшего отделения по суммарному времени T = T(дорога) + T(очередь).
   - Фильтры по услугам (посылки, письма, пенсии) и доступной среде для маломобильных граждан.
   - Geofencing (75 метров): автоматическое определение прибытия к отделению по GPS браузера.
4. **Уведомления**: звуковой гонг при вызове к окну (Web Audio), системные всплывающие Web Push уведомления, SMS-сообщения, официальный Telegram-бот (@poiters_inno_bot).
5. **Оценка качества и история визитов**: после обслуживания пользователь может поставить от 1 до 5 звезд оператору и оставить отзыв. В личном кабинете сохраняется детальная история всех визитов (дата, время, окно, оператор, длительность).
6. **Электронные табло**: /board (доска вызова талонов) и /tv (полноэкранное табло зала ожидания с аудио-озвучкой диктора).
7. **Рабочие кабинеты**: /operator (рабочее место оператора для вызова клиентов) и /admin (панель администратора).

Правила общения:
- Обращайся к пользователю вежливо на русском языке, доброжелательно и структурированно.
- Если в контексте указано имя или ФИО пользователя, обращайся к нему по имени и приветствуй персонализированно.
- Если пользователь спрашивает «Как меня зовут?», «Кто я?», «Какой у меня телефон/email?» — отвечай строго на основе предоставленных данных профиля пользователя из контекста.
- Если пользователь спрашивает «Где я нахожусь?», «Какое отделение ближе?», «Куда мне идти?» — отвечай на основе его координат и информации о ближайшем отделении из контекста (назови название, адрес, станцию метро и точное расстояние).
- Если пользователь спрашивает о своих талонах («Какие у меня талоны?», «Проверь мои талоны», «Сколько мне ждать?») — перечисли все его активные талоны из контекста (номера, услуги, статус, время).
- Непрерывность и контекст диалога:
  * Внимательно анализируй ВСЮ историю предыдущих сообщений в диалоге.
  * Помни все сущности, которые пользователь назвал ранее: выбранное отделение, услугу, дату, время записи.
  * Если пользователь говорит кратко (например: «в Покровку», «на 2 октября», «в 12:00», «поменяй на 14:00»), это прямое продолжение диалога. Ни в коем случае не теряй контекст!
  * Если пользователь использует местоимения («а как оно работает?», «какое там метро?», «а сколько это стоит?»), местоимения «оно», «там», «туда» относятся к ранее названному в переписке отделению или услуге.
- Строго придерживайся фактов из базы знаний Почты России. Не выдумывай несуществующие тарифы или правила.
"""

def _build_session_context(context: Dict[str, Any], cards: List[Dict[str, Any]], matched_service_name: str = "") -> str:
    ctx_parts = []

    # 1. User profile
    user = context.get("user") or {}
    user_name = user.get("name") or user.get("fio")
    user_email = user.get("email")
    user_phone = user.get("phone")

    if user_name or user_email:
        ctx_parts.append(
            f"👤 ДАННЫЕ АВТОРИЗОВАННОГО ПОЛЬЗОВАТЕЛЯ:\n"
            f"- Имя/ФИО: {user_name or 'Клиент'}\n"
            f"- Телефон: {user_phone or 'не указан'}\n"
            f"- Email: {user_email or 'не указан'}\n"
            f"(Инструкция: обращайся к пользователю по имени {user_name or 'Клиент'}. Если он спросит, как его зовут, кто он или какой у него телефон/email — обязательно назови эти данные)."
        )
    else:
        ctx_parts.append("👤 ПОЛЬЗОВАТЕЛЬ: Гость (не авторизован в личном кабинете).")

    # 2. User location and nearest branch
    loc = context.get("location") or {}
    coords = loc.get("coordinates") or {"lat": loc.get("lat"), "lng": loc.get("lng")}
    nb = loc.get("nearest_branch")
    if coords and coords.get("lat"):
        loc_text = f"📍 ГЕОЛОКАЦИЯ ПОЛЬЗОВАТЕЛЯ:\n- Текущие координаты: широта {coords.get('lat')}, долгота {coords.get('lng')}\n"
        if nb:
            dist_str = nb.get("distance_text") or (f"{nb.get('distance_meters')} м" if nb.get("distance_meters") is not None else "")
            loc_text += (
                f"- Ближайшее отделение Почты России: {nb.get('name')}\n"
                f"- Адрес: {nb.get('address')}\n"
                f"- Метро: {nb.get('metro', 'рядом')}\n"
                f"- Расстояние от пользователя: {dist_str}\n"
                f"(Инструкция: если пользователь спрашивает «Где я?», «Какое отделение ко мне ближе всего?», «Как мне добраться?», обязательно сообщи эти точные координаты, адрес и расстояние)."
            )
        ctx_parts.append(loc_text)

    # 3. Active tickets in personal cabinet
    tickets = context.get("active_tickets") or []
    if tickets:
        t_lines = []
        for t in tickets:
            t_num = t.get("number") or "Талон"
            t_srv = t.get("serviceName") or t.get("service") or "Почтовые услуги"
            t_st = t.get("status") or "WAITING"
            t_lines.append(f"  • Талон №{t_num}: услуга «{t_srv}», статус [{t_st}], ID: {t.get('id', '')}")
        ctx_parts.append(
            f"🎫 АКТИВНЫЕ ТАЛОНЫ В ЛИЧНОМ КАБИНЕТЕ ПОЛЬЗОВАТЕЛЯ ({len(tickets)} шт.):\n" +
            "\n".join(t_lines) +
            "\n(Инструкция: если пользователь спрашивает про свои талоны, обязательно перечисли их все, назови их номера и текущие статусы)."
        )
    elif context.get("ticket_id"):
        ctx_parts.append(f"🎫 Активный талон в сессии: {context['ticket_id']}")
    else:
        ctx_parts.append("🎫 АКТИВНЫЕ ТАЛОНЫ: В личном кабинете пользователя сейчас нет активных талонов.")

    # 4. Selected branch
    if context.get("branch_id"):
        ctx_parts.append(f"🏢 Выбранное в интерфейсе отделение (ID): {context['branch_id']}")

    # 5. Executed actions in current turn
    if cards:
        for card in cards:
            if card["type"] == "ticket_created":
                t_info = card["data"]
                ctx_parts.append(
                    f"✅ ДЕЙСТВИЕ ВЫПОЛНЕНО: Клиент только что успешно записан в очередь!\n"
                    f"- Номер оформленного талона: {t_info.get('publicNumber')}\n"
                    f"- Услуга: «{t_info.get('serviceName', matched_service_name)}»\n"
                    f"- Талон мгновенно сохранён и привязан к личному кабинету пользователя в «Мои талоны»!\n"
                    f"В ответе обязательно назови номер талона {t_info.get('publicNumber')}, подтверди привязку к личному кабинету и напомни следить за табло."
                )
            elif card["type"] == "ticket_status":
                t_data = card["data"]
                t = t_data.get("ticket", {})
                pos = t_data.get("position", {})
                eta = t_data.get("eta", {})
                pos_val = pos.get("position", 0)
                eta_val = (eta.get("estimatedWaitSeconds") or eta.get("predictedEtaSeconds") or 180) // 60
                ctx_parts.append(
                    f"📊 СТАТУС ТАЛОНА: Номер {t.get('publicNumber')}, перед клиентом в очереди: {pos_val} чел., расчетное ожидание: ~{eta_val} мин. Обязательно назови эти данные клиенту."
                )

    return "\n\n".join(ctx_parts)

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "Поиск по базе знаний Почты России (правила отправки, упаковка, запрещенные предметы, ПЭП, хранение, доверенности).",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Поисковый запрос, например 'правила отправки посылки' или 'получение без паспорта'."
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "check_ticket_status",
            "description": "Проверить статус талона клиента, позицию в очереди и примерное время ожидания.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticket_id": {
                        "type": "string",
                        "description": "UUID идентификатор талона клиента."
                    }
                },
                "required": ["ticket_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_services",
            "description": "Получить список доступных услуг почтового отделения.",
            "parameters": {
                "type": "object",
                "properties": {
                    "branch_id": {
                        "type": "string",
                        "description": "ID отделения почты."
                    }
                },
                "required": ["branch_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_queue_ticket",
            "description": "Взять талон в живую очередь или записаться на конкретное время в отделение.",
            "parameters": {
                "type": "object",
                "properties": {
                    "branch_id": {
                        "type": "string",
                        "description": "ID отделения."
                    },
                    "service_id": {
                        "type": "string",
                        "description": "ID выбранной услуги."
                    },
                    "scheduled_at": {
                        "type": "string",
                        "description": "Дата и время записи в формате ISO (например 2026-10-01T14:30:00Z) или null для живой очереди."
                    }
                },
                "required": ["branch_id", "service_id"]
            }
        }
    }
]

class RAGAgent:
    def __init__(self, kb: Optional[KnowledgeBase] = None):
        self.kb = kb or KnowledgeBase()

    async def execute_tool(self, name: str, args: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Executes a tool by name with arguments and context."""
        logger.info(f"Executing tool: {name} with args: {args}")
        if name == "search_knowledge_base":
            query = args.get("query", "")
            results = self.kb.search(query, top_k=3)
            return {"results": results, "formatted": self.kb.format_for_prompt(results)}

        elif name == "check_ticket_status":
            ticket_id = args.get("ticket_id") or context.get("ticket_id")
            if not ticket_id:
                return {"error": "Номер или ID талона не указан."}
            data = await backend_client.get_ticket_details(ticket_id)
            if not data or not data.get("ticket"):
                return {"error": f"Талон {ticket_id} не найден."}
            return data

        elif name == "list_services":
            branch_id = args.get("branch_id") or context.get("branch_id")
            if not branch_id:
                branches = await backend_client.list_branches()
                if branches:
                    branch_id = branches[0]["id"]
            if not branch_id:
                return {"error": "Отделение не выбрано."}
            services = await backend_client.list_services(branch_id)
            return {"branch_id": branch_id, "services": services}

        elif name == "create_queue_ticket":
            branch_id = args.get("branch_id") or context.get("branch_id")
            service_id = args.get("service_id")
            scheduled_at = args.get("scheduled_at")
            if not branch_id or not service_id:
                return {"error": "Необходимо указать отделение и услугу."}
            if scheduled_at:
                res = await backend_client.create_appointment(branch_id, service_id, scheduled_at)
            else:
                res = await backend_client.create_qr_ticket(branch_id, service_id)
            if res:
                return {"success": True, "ticket": res}
            return {"error": "Не удалось создать талон. Попробуйте еще раз."}

        return {"error": f"Неизвестный инструмент: {name}"}

class GigaChatProvider:
    def __init__(self, credentials: str, scope: str = "GIGACHAT_API_PERS", model: str = "GigaChat"):
        self.credentials = credentials
        self.scope = scope
        self.model = model
        self.access_token: Optional[str] = None
        self.expires_at: int = 0

    async def get_token(self) -> str:
        now_ms = int(time.time() * 1000)
        if self.access_token and now_ms < (self.expires_at - 60000):
            return self.access_token

        url = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
        headers = {
            "Authorization": f"Basic {self.credentials}",
            "RqUID": str(uuid.uuid4()),
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {"scope": self.scope}
        async with httpx.AsyncClient(verify=False, timeout=12.0) as client:
            resp = await client.post(url, headers=headers, data=data)
            if resp.status_code != 200:
                raise RuntimeError(f"GigaChat OAuth failed: {resp.status_code} {resp.text}")
            res_data = resp.json()
            self.access_token = res_data["access_token"]
            self.expires_at = res_data.get("expires_at", now_ms + 1800000)
            return self.access_token

    async def complete(self, messages: List[Dict[str, str]], temperature: float = 0.3) -> str:
        token = await self.get_token()
        url = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        body = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature
        }
        async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code != 200:
                raise RuntimeError(f"GigaChat error {resp.status_code}: {resp.text}")
            res_data = resp.json()
            return res_data["choices"][0]["message"]["content"]

BRANCH_CATALOG = [
    {
        "id": "55555555-5555-5555-5555-555555555555",
        "name": "Отделение Солянка",
        "address": "г. Москва, ул. Солянка, д. 1/2",
        "keywords": ["солянк", "солянка", "солянке", "солянку", "солянкой"]
    },
    {
        "id": "77777777-7777-7777-7777-777777777777",
        "name": "Отделение Маросейка",
        "address": "г. Москва, ул. Маросейка, д. 9/2",
        "keywords": ["маросейк", "маросейка", "маросейке", "маросейку", "маросейкой"]
    },
    {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Главпочтамт (Мясницкая)",
        "address": "г. Москва, ул. Мясницкая, д. 26",
        "keywords": ["мясницк", "мясницкая", "мясницкой", "мясницкую", "главпочтамт на мясницкой", "московский главпочтамт", "чистые пруды"]
    },
    {
        "id": "10101010-1010-1010-1010-101010101010",
        "name": "Отделение Арбат",
        "address": "г. Москва, ул. Новый Арбат, д. 15",
        "keywords": ["арбат", "арбате", "арбату", "арбатом", "новый арбат"]
    },
    {
        "id": "88888888-8888-8888-8888-888888888888",
        "name": "Отделение Басманная",
        "address": "г. Москва, ул. Новая Басманная, д. 10",
        "keywords": ["басманн", "басманная", "басманной", "басманную", "басманке", "красные ворота"]
    },
    {
        "id": "44444444-4444-4444-4444-444444444444",
        "name": "Отделение Никольская",
        "address": "г. Москва, ул. Никольская, д. 8/1",
        "keywords": ["никольск", "никольская", "никольской", "никольскую", "лубянка"]
    },
    {
        "id": "99999999-9999-9999-9999-999999999999",
        "name": "Отделение Новослободская",
        "address": "г. Москва, ул. Новослободская, д. 20",
        "keywords": ["новослободск", "новослободская", "новослободской", "новослободскую", "менделеевская"]
    },
    {
        "id": "33333333-3333-3333-3333-333333333333",
        "name": "Отделение Покровка",
        "address": "г. Москва, ул. Покровка, д. 16",
        "keywords": ["покровк", "покровка", "покровке", "покровку", "покровкой", "покоровк", "покоровка", "покоровке", "покоровку", "курская"]
    },
    {
        "id": "22222222-2222-2222-2222-222222222222",
        "name": "Отделение Рождественка",
        "address": "г. Москва, ул. Рождественка, д. 10/2",
        "keywords": ["рождественк", "рождественка", "рождественке", "рождественку", "кузнецкий мост"]
    },
    {
        "id": "66666666-6666-6666-6666-666666666666",
        "name": "Отделение Тверская",
        "address": "г. Москва, ул. Тверская, д. 7",
        "keywords": ["тверск", "тверская", "тверской", "тверскую", "охотный ряд", "пушкинская"]
    },
    {
        "id": "5c791b5b-23ed-516e-800c-196f6de29ed9",
        "name": "Главпочтамт г. Рязань",
        "address": "г. Рязань, ул. Почтовая, д. 49",
        "keywords": ["рязан", "рязань", "рязани", "рязанью", "почтов", "почтовая", "почтовой", "почтовую", "главпочтамт рязан", "главпочтамта рязан"]
    }
]

DEFAULT_SERVICES_CATALOG = [
    {"id": "22222222-2222-2222-2222-222222222222", "code": "PARCELS", "name": "Посылки"},
    {"id": "33333333-2222-2222-2222-222222222222", "code": "SEND", "name": "Письма и мелкие пакеты"},
    {"id": "55555555-5555-5555-5555-555555555555", "code": "PAYMENTS", "name": "Платежи и переводы"},
    {"id": "44444444-2222-2222-2222-222222222222", "code": "RETAIL", "name": "Розничные товары и услуги"},
]

_PENDING_BOOKINGS: Dict[str, Dict[str, Any]] = {}

def _parse_appointment_date_time(q_lower: str, base_iso: Optional[str] = None) -> tuple[str, str]:
    """Extracts scheduled ISO timestamp and Russian formatted string from natural language text, with base_iso support for incremental updates."""
    now = datetime.datetime.now()
    if now.year < 2026:
        now = now.replace(year=2026)

    year = now.year
    month = None
    day = None
    hour = 10
    minute = 0

    if base_iso:
        try:
            base_dt = datetime.datetime.fromisoformat(base_iso.replace("Z", "+00:00"))
            year, month, day = base_dt.year, base_dt.month, base_dt.day
            hour, minute = base_dt.hour, base_dt.minute
        except Exception:
            pass

    months_ru = {
        'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4, 'мая': 5, 'мае': 5, 'май': 5, 'июн': 6,
        'июл': 7, 'август': 8, 'сентябр': 9, 'октябр': 10, 'октярб': 10, 'ноябр': 11, 'декабр': 12
    }
    date_pattern_1 = r'(\d{1,2})\s*(январ\w*|феврал\w*|март\w*|апрел\w*|ма[яе]|май|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|октярб\w*|ноябр\w*|декабр\w*)'
    date_pattern_2 = r'(январ\w*|феврал\w*|март\w*|апрел\w*|ма[яе]|май|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|октярб\w*|ноябр\w*|декабр\w*)\s*(\d{1,2})\b'

    date_m1 = re.search(date_pattern_1, q_lower)
    date_m2 = re.search(date_pattern_2, q_lower)

    matched_date_str = ""
    if date_m1:
        day = int(date_m1.group(1))
        m_str = date_m1.group(2)
        matched_date_str = date_m1.group(0)
        for k, v in months_ru.items():
            if m_str.startswith(k) or k.startswith(m_str):
                month = v
                break
    elif date_m2:
        day = int(date_m2.group(2))
        m_str = date_m2.group(1)
        matched_date_str = date_m2.group(0)
        for k, v in months_ru.items():
            if m_str.startswith(k) or k.startswith(m_str):
                month = v
                break
    elif 'послезавтра' in q_lower:
        d = now + datetime.timedelta(days=2)
        year, month, day = d.year, d.month, d.day
    elif 'завтра' in q_lower:
        d = now + datetime.timedelta(days=1)
        year, month, day = d.year, d.month, d.day
    elif 'сегодня' in q_lower:
        year, month, day = now.year, now.month, now.day
    elif month is None:
        if not base_iso:
            d = now + datetime.timedelta(days=1)
            year, month, day = d.year, d.month, d.day

    if month is None:
        month = now.month
    if day is None:
        day = now.day

    q_without_date = q_lower
    if matched_date_str:
        q_without_date = q_lower.replace(matched_date_str, ' ')

    m_time = re.search(r'(\d{1,2})[:.](\d{2})', q_without_date)
    if m_time:
        hour = int(m_time.group(1))
        minute = int(m_time.group(2))
    else:
        m_time2 = re.search(r'(?:в|на)?\s*(\d{1,2})\s*(утра|дня|вечера|ночи|час\w*)', q_without_date)
        if m_time2:
            hour = int(m_time2.group(1))
            period = m_time2.group(2)
            if any(p in period for p in ['дня', 'вечера']) and hour < 12:
                hour += 12
            minute = 0
        else:
            m_time3 = re.search(r'(?:в|на)\s+(\d{1,2})\b', q_without_date)
            if m_time3:
                hour = int(m_time3.group(1))
                minute = 0

    months_gen = {1: 'января', 2: 'февраля', 3: 'марта', 4: 'апреля', 5: 'мая', 6: 'июня', 7: 'июля', 8: 'августа', 9: 'сентября', 10: 'октября', 11: 'ноября', 12: 'декабря'}
    iso_str = f'{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00Z'
    text_str = f'{day} {months_gen.get(month, "")} {year} г., {hour:02d}:{minute:02d}'
    return iso_str, text_str

def _extract_conversation_state(messages: List[Dict[str, str]], context: Dict[str, Any]) -> Dict[str, Any]:
    """Extracts entities, active branches, services, timestamps, and intents across the entire dialogue history."""
    user_messages = [m.get("content", "") for m in messages if m.get("role") == "user"]
    last_user_msg = user_messages[-1] if user_messages else ""
    last_user_lower = last_user_msg.lower()

    assistant_messages = [m.get("content", "") for m in messages if m.get("role") == "assistant"]
    last_assistant_msg = assistant_messages[-1] if assistant_messages else ""
    last_assistant_lower = last_assistant_msg.lower()

    user = context.get("user") or {}
    session_key = str(user.get("id") or user.get("email") or context.get("ticket_id") or "default_user")
    existing_pending = context.get("pending_booking") or _PENDING_BOOKINGS.get(session_key) or _PENDING_BOOKINGS.get("default_user")

    # 1. Match Branch (current message -> prior messages -> assistant message if user says 'туда' -> pending booking -> context -> default)
    matched_branch = None
    for b in BRANCH_CATALOG:
        if any(k in last_user_lower for k in b["keywords"]):
            matched_branch = b
            break
    if not matched_branch:
        for prev in reversed(user_messages[:-1]):
            prev_lower = prev.lower()
            for b in BRANCH_CATALOG:
                if any(k in prev_lower for k in b["keywords"]):
                    matched_branch = b
                    break
            if matched_branch:
                break
    # If user used anaphoric reference ("туда", "в это отделение", "в него", "в то", "в ближайшее", "к вам")
    if not matched_branch and any(w in last_user_lower for w in ["туда", "в это", "в него", "в то", "в данное", "в ближайш", "к вам"]):
        nearest_id = context.get("location", {}).get("nearest_branch", {}).get("id")
        nearest_b = next((b for b in BRANCH_CATALOG if b["id"] == nearest_id), None) if nearest_id else None
        
        # Check last assistant message for the most specific (longest) keyword match
        best_match = None
        best_k_len = 0
        for b in BRANCH_CATALOG:
            for k in b["keywords"]:
                if k in last_assistant_lower and len(k) > best_k_len:
                    best_match = b
                    best_k_len = len(k)
        
        if best_match:
            matched_branch = best_match
        elif nearest_b:
            matched_branch = nearest_b

    if not matched_branch and existing_pending and existing_pending.get("branchId"):
        matched_branch = next((b for b in BRANCH_CATALOG if b["id"] == existing_pending["branchId"]), None)
    if not matched_branch and context.get("branch_id"):
        matched_branch = next((b for b in BRANCH_CATALOG if b["id"] == context["branch_id"]), None)
    if not matched_branch and context.get("location", {}).get("nearest_branch", {}).get("id"):
        matched_branch = next((b for b in BRANCH_CATALOG if b["id"] == context["location"]["nearest_branch"]["id"]), None)
    if not matched_branch:
        matched_branch = next((b for b in BRANCH_CATALOG if "покровк" in b["keywords"]), BRANCH_CATALOG[0])

    # 2. Match Service
    service_keywords = {
        "PARCELS": ["посылк", "посылка", "посылки", "посылок", "посылку", "ems", "1 класс", "первый класс", "посылочн", "тяжеловесн", "коробк", "бандерол", "груз"],
        "SEND": ["письм", "письмо", "письма", "письме", "открытк", "корреспонденц", "уведомлен", "марк"],
        "PAYMENTS": ["платеж", "оплат", "перевод", "коммунал", "штраф", "налог", "пошлин", "квартплат"],
        "RETAIL": ["пенси", "пособи", "социальн", "товар", "газет", "журнал"]
    }
    matched_service_code = None
    for code, kws in service_keywords.items():
        if any(k in last_user_lower for k in kws):
            matched_service_code = code
            break
    if not matched_service_code:
        for prev in reversed(user_messages[:-1]):
            prev_lower = prev.lower()
            for code, kws in service_keywords.items():
                if any(k in prev_lower for k in kws):
                    matched_service_code = code
                    break
            if matched_service_code:
                break
    if not matched_service_code and existing_pending and existing_pending.get("serviceId"):
        for def_s in DEFAULT_SERVICES_CATALOG:
            if def_s["id"] == existing_pending.get("serviceId"):
                matched_service_code = def_s["code"]
                break
    if not matched_service_code:
        matched_service_code = "PARCELS"

    # 3. Match Date / Time
    date_indicators = [
        "январ", "феврал", "март", "апрел", " мая", " мае", " май", "июн", "июл", "август", "сентябр", "октябр", "октярб", "ноябр", "декабр",
        "сегодня", "завтра", "послезавтра", "часов", "утра", "дня", "вечера"
    ]
    has_datetime = (
        any(m in last_user_lower for m in date_indicators) or
        bool(re.search(r'\b\d{1,2}[:.]\d{2}\b', last_user_lower)) or
        bool(re.search(r'(?:в|на)\s+\d{1,2}\b', last_user_lower))
    )

    base_iso = existing_pending.get("scheduledAt") if existing_pending else None
    if has_datetime:
        scheduled_iso, scheduled_text = _parse_appointment_date_time(last_user_lower, base_iso=base_iso)
        is_appointment = True
    elif base_iso:
        scheduled_iso = base_iso
        scheduled_text = existing_pending.get("scheduledText", "")
        is_appointment = True
    else:
        scheduled_iso, scheduled_text = None, None
        for prev in reversed(user_messages[:-1]):
            prev_lower = prev.lower()
            if any(m in prev_lower for m in date_indicators) or re.search(r'\b\d{1,2}[:.]\d{2}\b', prev_lower) or re.search(r'(?:в|на)\s+\d{1,2}\b', prev_lower):
                scheduled_iso, scheduled_text = _parse_appointment_date_time(prev_lower)
                break
        is_appointment = scheduled_iso is not None

    if not is_appointment and any(k in last_user_lower for k in ["онлайн", "онлайном", "предварительн", "ко времени", "на время", "забронир", "запись"]):
        scheduled_iso, scheduled_text = _parse_appointment_date_time(last_user_lower)
        is_appointment = True

    if any(k in last_user_lower for k in ["в живую", "живая очередь", "прямо сейчас", "сейчас", "онлайн", "qr", "кьюар"]):
        if not has_datetime:
            is_appointment = False
            scheduled_iso = None
            scheduled_text = "Онлайн-талон по QR-коду (электронная очередь)"

    # Confirmation & Cancellation
    confirmation_patterns = [
        r'^(да|давай|верно|всё верно|все верно|правильно|все правильно|всё правильно|подтверждаю|да подтверждаю|ок|yes|yep|хорошо|подходит)\b',
        r'\b(да, подтверждаю|подтверждаю|все верно|всё верно|все правильно|всё правильно)\b'
    ]
    is_confirm = any(re.search(pat, last_user_lower.strip()) for pat in confirmation_patterns) or last_user_lower.strip() in ["да", "да.", "да!", "верно", "ок"]

    cancel_patterns = [r'^(нет|отмена|отмени|не надо|не хочу|неверно|ошибка|стоп)\b']
    is_cancel = any(re.search(pat, last_user_lower.strip()) for pat in cancel_patterns) or last_user_lower.strip() in ["нет", "нет.", "отмена", "отменить"]

    is_prompt_request = any(k in last_user_lower for k in ["дай промт", "дай промпт", "напиши промт", "напиши промпт", "какой промт", "какой промпт"])

    booking_keywords = [
        "запиши", "записать", "записаться", "взять талон", "возьми талон", "возьми мне талон",
        "занять очередь", "хочу талон", "оформи талон", "оформить талон", "выбей талон",
        "дай талон", "получить талон", "талон на", "талон в очередь", "встать в очередь",
        "онлайн-запись", "онлайн запись", "онлайном", "запись ко времени", "забронируй", "забронировать"
    ]
    has_booking_kw = any(w in last_user_lower for w in booking_keywords)

    ticket_inquiry_patterns = [
        "мои талон", "мой талон", "моих талон", "моем талон", "моём талон",
        "какие талон", "список талон", "какие у меня", "проверь талон",
        "покажи талон", "расскажи про талон", "расксажи про", "расскажи о талон",
        "расксажи о талон", "статус талон", "где талон", "сколько ждать",
        "какой в очереди", "позиция в очереди", "активные талон", "мои записи",
        "моя запись", "мои очереди", "мои номерки"
    ]
    is_ticket_inquiry = any(k in last_user_lower for k in ticket_inquiry_patterns) or (
        any(w in last_user_lower for w in ["талон", "талоны", "записи"]) and
        any(w in last_user_lower for w in ["мои", "мой", "моих", "моем", "моём", "какие", "список", "провер", "покаж", "расскаж", "расксаж", "где", "статус", "активн", "есть", "сколько", "про"])
    ) or last_user_lower.strip() in ["мои талоны", "мои талоны?", "талоны", "талоны?", "мои записи", "мои записи?"]

    was_prompting_booking = any(p in last_assistant_lower for p in [
        "на какое время", "какую услугу", "в какое отделение", "выбрать другое время",
        "записать вас", "проверьте данные для записи", "удобное время", "онлайн-запись"
    ])

    is_modification = bool(
        existing_pending and not is_cancel and not is_confirm and
        (has_datetime or any(k in last_user_lower for k in ["поменяй", "перенеси", "лучше", "другое время", "другое отделение"]))
    )

    is_booking_intent = (
        (is_prompt_request or
        has_booking_kw or
        is_modification or
        (was_prompting_booking and (has_datetime or any(k in last_user_lower for k in matched_branch["keywords"]))))
        and not is_ticket_inquiry
    )

    return {
        "session_key": session_key,
        "existing_pending": existing_pending,
        "matched_branch": matched_branch,
        "matched_service_code": matched_service_code,
        "scheduled_iso": scheduled_iso,
        "scheduled_text": scheduled_text,
        "is_appointment": is_appointment,
        "is_confirm": is_confirm,
        "is_cancel": is_cancel,
        "is_prompt_request": is_prompt_request,
        "is_modification": is_modification,
        "is_booking_intent": is_booking_intent,
        "is_ticket_inquiry": is_ticket_inquiry,
        "last_user_lower": last_user_lower,
    }

class RAGAgent:
    def __init__(self, kb: Optional[KnowledgeBase] = None):
        self.kb = kb or KnowledgeBase()
        self.gigachat = GigaChatProvider(GIGACHAT_CREDENTIALS, GIGACHAT_SCOPE, GIGACHAT_MODEL) if GIGACHAT_CREDENTIALS else None

    async def chat(
        self,
        messages: List[Dict[str, str]],
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Main chat method supporting GigaChat, OpenAI LLM, and autonomous intelligent fallback."""
        context = context or {}
        last_user_message = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user_message = m.get("content", "")
                break

        # Priority 1: Multi-turn deterministic booking and context resolution
        booking_result = await self._handle_booking_intent(messages, context)
        if booking_result:
            return booking_result

        # Extract current state for enriched prompting
        state = _extract_conversation_state(messages, context)

        # Priority 2: Check if Sber GigaChat is configured and available
        if GIGACHAT_CREDENTIALS and len(GIGACHAT_CREDENTIALS.strip()) > 10:
            try:
                if not self.gigachat:
                    self.gigachat = GigaChatProvider(GIGACHAT_CREDENTIALS, GIGACHAT_SCOPE, GIGACHAT_MODEL)
                return await self._chat_with_gigachat(messages, context, last_user_message, state)
            except Exception as e:
                logger.warning(f"GigaChat call failed ({e}), trying next provider...")

        # Priority 3: Check if OpenAI is configured and available
        if OPENAI_API_KEY and len(OPENAI_API_KEY.strip()) > 5:
            try:
                return await self._chat_with_llm(messages, context, last_user_message)
            except Exception as e:
                logger.warning(f"LLM call failed ({e}), switching to autonomous RAG engine.")

        # Priority 4: Autonomous high-quality RAG fallback with history retention
        return await self._chat_autonomous(last_user_message, context, messages=messages, state=state)

    async def _build_pending_booking(
        self,
        messages: List[Dict[str, str]],
        context: Dict[str, Any],
        state: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        state = state or _extract_conversation_state(messages, context)
        matched_branch = state["matched_branch"]
        branch_id = matched_branch["id"]

        # Fetch services from backend with automatic fallback to catalog
        services = await backend_client.list_services(branch_id)
        if not services:
            services = DEFAULT_SERVICES_CATALOG

        # Match Service
        target_code = state["matched_service_code"]
        matched_service = services[0]
        for s in services:
            s_code = s.get("code", "").upper()
            if target_code in s_code or s_code in target_code:
                matched_service = s
                break

        matched_service_name = matched_service.get("name", "Почтовые услуги")

        if state["is_appointment"] and state["scheduled_iso"]:
            booking_type = "APPOINTMENT"
            booking_type_name = "Предварительная онлайн-запись (ко времени)"
            scheduled_iso = state["scheduled_iso"]
            scheduled_text = state["scheduled_text"]
        else:
            booking_type = "QR"
            booking_type_name = "Онлайн-талон по QR-коду"
            scheduled_iso = None
            scheduled_text = "Онлайн по QR-коду (электронная очередь)"

        return {
            "bookingType": booking_type,
            "bookingTypeName": booking_type_name,
            "branchId": matched_branch["id"],
            "branchName": matched_branch["name"],
            "branchAddress": matched_branch["address"],
            "serviceId": matched_service["id"],
            "serviceName": matched_service_name,
            "scheduledAt": scheduled_iso,
            "scheduledText": scheduled_text
        }

    async def _handle_booking_intent(
        self,
        messages: List[Dict[str, str]],
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Handles user intent to book, verify details, and confirm ticket issuing using full conversation history."""
        user = context.get("user") or {}
        user_name = user.get("name") or user.get("fio")
        user_greeting = f"Здравствуйте, {user_name}! " if user_name else "Здравствуйте! "
        user_phone = user.get("phone") or ""
        user_email = user.get("email") or ""

        state = _extract_conversation_state(messages, context)
        session_key = state["session_key"]
        existing_pending = state["existing_pending"]

        # 1. Handle CONFIRMATION ("Да", "Подтверждаю")
        if state["is_confirm"]:
            pending = existing_pending
            if not pending and messages:
                pending = await self._build_pending_booking(messages, context, state)

            if pending:
                _PENDING_BOOKINGS.pop(session_key, None)
                _PENDING_BOOKINGS.pop("default_user", None)

                branch_id = pending.get("branchId")
                service_id = pending.get("serviceId")
                booking_type = pending.get("bookingType", "QR")

                if booking_type == "APPOINTMENT":
                    ticket_res = await backend_client.create_appointment(
                        branch_id=branch_id,
                        service_id=service_id,
                        scheduled_at=pending.get("scheduledAt"),
                        phone=user_phone,
                        email=user_email
                    )
                else:
                    ticket_res = await backend_client.create_qr_ticket(
                        branch_id=branch_id,
                        service_id=service_id
                    )

                if ticket_res and ticket_res.get("publicNumber"):
                    cards = [{"type": "ticket_created", "data": ticket_res}]
                    t_num = ticket_res.get("publicNumber")
                    t_srv = ticket_res.get("serviceName", pending.get("serviceName", "Почтовые услуги"))
                    br_name = pending.get("branchName", "Отделение Почты")
                    br_addr = pending.get("branchAddress", "")

                    if booking_type == "APPOINTMENT":
                        msg_text = (
                            f"{user_greeting}🎉 **Ваша предварительная запись подтверждена и оформлена!**\n\n"
                            f"🎫 Номер талона: **{t_num}**\n"
                            f"🏢 Отделение: **{br_name}** ({br_addr})\n"
                            f"📅 Время записи: **{pending.get('scheduledText', '')}**\n"
                            f"📦 Услуга: **{t_srv}**\n\n"
                            f"Талон автоматически сохранён и привязан к вашему Личному кабинету в разделе **«Мои талоны»**.\n"
                            f"✨ В назначенное время ваш номер появится на центральном табло отделения — вы будете приглашены к окну без ожидания в общей очереди!"
                        )
                    else:
                        msg_text = (
                            f"{user_greeting}🎉 **Ваш онлайн-талон по QR-коду успешно оформлен!**\n\n"
                            f"🎫 Номер талона: **{t_num}**\n"
                            f"🏢 Отделение: **{br_name}** ({br_addr})\n"
                            f"📱 Тип: **Онлайн-талон по QR-коду**\n"
                            f"📦 Услуга: **{t_srv}**\n\n"
                            f"Талон автоматически сохранён и отображается в вашем Личном кабинете в разделе **«Мои талоны»**. Вам не требуется брать бумажный талон в терминале отделения.\n"
                            f"🔔 Ожидайте вызова на центральном табло отделения. Мы уведомим вас сообщением и звуковым сигналом при вызове к окну!"
                        )

                    return {
                        "text": msg_text,
                        "sources": [{"title": "Электронная очередь Почты России", "category": "Сервис"}],
                        "cards": cards
                    }
                else:
                    return {
                        "text": "⚠️ Не удалось создать талон в отделении. Пожалуйста, попробуйте еще раз.",
                        "sources": [{"title": "Электронная очередь", "category": "Сервис"}],
                        "cards": []
                    }

        # 2. Handle CANCELLATION ("Нет", "Отмена")
        if state["is_cancel"] and (session_key in _PENDING_BOOKINGS or "default_user" in _PENDING_BOOKINGS):
            _PENDING_BOOKINGS.pop(session_key, None)
            _PENDING_BOOKINGS.pop("default_user", None)
            return {
                "text": "👌 Понял вас, запись отменена. Если вы захотите записаться в другое отделение или выбрать другое время/услугу — просто напишите мне!",
                "sources": [{"title": "Электронная очередь", "category": "Сервис"}],
                "cards": []
            }

        # If this is a ticket inquiry, do not hijack with booking intent
        if state.get("is_ticket_inquiry"):
            return None

        # 3. Handle BOOKING INTENT or MODIFICATION or PROMPT REQUEST
        if not state["is_booking_intent"]:
            return None

        pending = await self._build_pending_booking(messages, context, state)
        if not pending:
            return {
                "text": "⚠️ Сервис электронной очереди временно недоступен. Пожалуйста, попробуйте снова через несколько минут.",
                "sources": [{"title": "Электронная очередь", "category": "Сервис"}],
                "cards": []
            }

        _PENDING_BOOKINGS[session_key] = pending
        _PENDING_BOOKINGS["default_user"] = pending

        if state["is_prompt_request"]:
            confirm_text = (
                f"✨ **Вот готовый промт для быстрой онлайн-записи:**\n"
                f"💬 *«Запиши меня онлайном на {pending['scheduledText']} в {pending['branchName']} на {pending['serviceName']}»*\n\n"
                f"Я уже автоматически распознал все параметры вашей записи и подготовил карточку талона:\n\n"
                f"• **Тип:** {pending['bookingTypeName']}\n"
                f"• **Отделение:** {pending['branchName']} ({pending['branchAddress']})\n"
                f"• **Дата и время:** {pending['scheduledText']}\n"
                f"• **Услуга:** {pending['serviceName']}\n\n"
                f"Все верно? Нажмите кнопку **«Да, всё верно»** ниже или ответьте **«Да»**, чтобы выпустить талон!"
            )
        elif state["is_modification"]:
            confirm_text = (
                f"🔄 **Данные записи обновлены с учётом ваших изменений:**\n\n"
                f"• **Тип:** {pending['bookingTypeName']}\n"
                f"• **Отделение:** {pending['branchName']} ({pending['branchAddress']})\n"
                f"• **Дата и время:** {pending['scheduledText']}\n"
                f"• **Услуга:** {pending['serviceName']}\n\n"
                f"Все верно? Ответьте **«Да»** или нажмите кнопку ниже, чтобы выпустить талон."
            )
        else:
            confirm_text = (
                f"📋 **Пожалуйста, проверьте данные для записи:**\n\n"
                f"• **Тип:** {pending['bookingTypeName']}\n"
                f"• **Отделение:** {pending['branchName']} ({pending['branchAddress']})\n"
                f"• **Дата и время:** {pending['scheduledText']}\n"
                f"• **Услуга:** {pending['serviceName']}\n\n"
                f"Все данные верны? Ответьте **«Да»**, чтобы выпустить талон."
            )

        return {
            "text": confirm_text,
            "sources": [{"title": "Электронная очередь Почты России", "category": "Сервис"}],
            "cards": [{"type": "booking_confirmation_pending", "data": pending}]
        }

    async def _chat_with_gigachat(
        self,
        messages: List[Dict[str, str]],
        context: Dict[str, Any],
        user_query: str,
        state: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Executes dialogue using official Sber GigaChat API with RAG context and actions."""
        q_lower = user_query.lower()
        cards = []

        # Action 1: Check ticket status if requested
        if any(w in q_lower for w in ["мой талон", "статус талона", "сколько ждать", "какой в очереди"]):
            ticket_id = context.get("ticket_id")
            if ticket_id:
                details = await backend_client.get_ticket_details(ticket_id)
                if details and details.get("ticket"):
                    cards.append({"type": "ticket_status", "data": details})

        # RAG Retrieval: Top chunks from Knowledge Base
        retrieved = self.kb.search(user_query, top_k=4)
        kb_context = self.kb.format_for_prompt(retrieved)

        session_ctx = _build_session_context(context, cards)

        enriched_system = (
            f"{SYSTEM_PROMPT}\n\n"
            f"[Контекст текущего пользователя и сессии]:\n{session_ctx}\n\n"
            f"[Официальная база знаний Почты России]:\n{kb_context}"
        )

        if state and state.get("matched_branch"):
            br = state["matched_branch"]
            enriched_system += (
                f"\n\n[Текущий контекст диалога]: Пользователь интересуется отделением «{br['name']}» "
                f"(адрес: {br['address']}). Если он спрашивает о графике, метро или проезде — отвечай именно про это отделение."
            )

        gigachat_messages = [{"role": "system", "content": enriched_system}]
        for m in messages[-14:]:
            gigachat_messages.append({"role": m["role"], "content": m["content"]})

        answer = await self.gigachat.complete(gigachat_messages, temperature=0.3)
        return {
            "text": answer,
            "sources": [{"title": r["title"], "category": r["category"]} for r in retrieved],
            "cards": cards
        }

    async def _chat_with_llm(
        self,
        messages: List[Dict[str, str]],
        context: Dict[str, Any],
        user_query: str
    ) -> Dict[str, Any]:
        """Interacts with OpenAI-compatible API using function calling."""
        # 1. Pre-retrieve relevant knowledge base chunks
        retrieved = self.kb.search(user_query, top_k=4)
        kb_context = self.kb.format_for_prompt(retrieved)

        session_ctx = _build_session_context(context, [])

        enriched_system = f"{SYSTEM_PROMPT}\n\n[Контекст сеанса и пользователя]:\n{session_ctx}\n\n[База знаний Почты России]:\n{kb_context}"

        llm_messages = [{"role": "system", "content": enriched_system}]
        for m in messages[-6:]:
            llm_messages.append({"role": m["role"], "content": m["content"]})

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json"
        }
        body = {
            "model": OPENAI_MODEL,
            "messages": llm_messages,
            "tools": TOOL_DEFINITIONS,
            "tool_choice": "auto",
            "temperature": 0.2
        }

        cards = []
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{OPENAI_BASE_URL}/chat/completions", json=body, headers=headers)
            if resp.status_code != 200:
                raise RuntimeError(f"OpenAI error {resp.status_code}: {resp.text}")

            res_data = resp.json()
            choice = res_data["choices"][0]["message"]

            if choice.get("tool_calls"):
                tool_calls = choice["tool_calls"]
                llm_messages.append(choice)

                for tc in tool_calls:
                    func_name = tc["function"]["name"]
                    func_args = json.loads(tc["function"].get("arguments", "{}"))
                    tool_res = await self.execute_tool(func_name, func_args, context)

                    if func_name == "create_queue_ticket" and tool_res.get("ticket"):
                        cards.append({"type": "ticket_created", "data": tool_res["ticket"]})
                    elif func_name == "check_ticket_status" and tool_res.get("ticket"):
                        cards.append({"type": "ticket_status", "data": tool_res})

                    llm_messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": func_name,
                        "content": json.dumps(tool_res, ensure_ascii=False)
                    })

                body["messages"] = llm_messages
                followup_resp = await client.post(f"{OPENAI_BASE_URL}/chat/completions", json=body, headers=headers)
                if followup_resp.status_code == 200:
                    followup_data = followup_resp.json()
                    final_text = followup_data["choices"][0]["message"].get("content", "")
                    return {
                        "text": final_text,
                        "sources": [{"title": r["title"], "category": r["category"]} for r in retrieved],
                        "cards": cards
                    }

            return {
                "text": choice.get("content", ""),
                "sources": [{"title": r["title"], "category": r["category"]} for r in retrieved],
                "cards": cards
            }

    async def _chat_autonomous(
        self,
        query: str,
        context: Dict[str, Any],
        messages: Optional[List[Dict[str, str]]] = None,
        state: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Intelligent zero-key intent and RAG processor for instant offline/demo reliability with multi-turn context."""
        q_lower = query.lower()
        cards = []
        sources = []
        messages = messages or []
        state = state or _extract_conversation_state(messages, context)
        current_branch = state.get("matched_branch")

        # Intent A: User identity & profile
        user = context.get("user") or {}
        user_name = user.get("name") or user.get("fio")
        user_email = user.get("email")
        user_phone = user.get("phone")

        if any(w in q_lower for w in ["как меня зовут", "кто я", "мое имя", "моё имя", "мой профиль", "мой телефон", "моя почта", "мои данные"]):
            if user_name or user_email:
                info_lines = []
                if user_name:
                    info_lines.append(f"Вас зовут **{user_name}**.")
                if user_phone:
                    info_lines.append(f"Телефон: **{user_phone}**.")
                if user_email:
                    info_lines.append(f"Электронная почта: **{user_email}**.")
                info_lines.append("\nВсе ваши талоны и история визитов автоматически привязаны к вашему Личному кабинету.")
                return {
                    "text": "👤 " + "\n".join(info_lines),
                    "sources": [{"title": "Личный кабинет пользователя", "category": "Профиль"}],
                    "cards": []
                }
            else:
                return {
                    "text": (
                        "👤 В данный момент вы находитесь на сайте как **Гость** (не авторизованы).\n\n"
                        "Вы можете войти в Личный кабинет через кнопку в правом верхнем углу сайта, чтобы сохранять свои данные, подтвердить телефон и просматривать историю визитов!"
                    ),
                    "sources": [{"title": "Личный кабинет пользователя", "category": "Профиль"}],
                    "cards": []
                }

        # Intent B: User Location & Nearest Branch
        loc = context.get("location") or {}
        nb = loc.get("nearest_branch")
        if any(w in q_lower for w in ["где я нахожусь", "где я", "мое местоположение", "моё местоположение", "ближайшее отделение", "какое отделение ближе", "куда мне идти", "где почта"]):
            if nb:
                dist_text = nb.get("distance_text") or (f"{nb.get('distance_meters')} м" if nb.get("distance_meters") is not None else "")
                return {
                    "text": (
                        f"📍 **Ваше текущее местоположение и ближайшее отделение:**\n\n"
                        f"Ближайшее к вам отделение Почты России:\n"
                        f"- 🏢 **{nb.get('name')}** (индекс {nb.get('code', '101000')})\n"
                        f"- 📮 Адрес: **{nb.get('address')}**\n"
                        f"- 🚇 Метро: **{nb.get('metro', 'рядом')}**\n"
                        f"- 🚶 Расстояние от вас: **{dist_text}**\n\n"
                        f"💡 На нашем сайте работает **Умная маршрутизация (Smart Routing)**: откройте Интерактивную карту, и система автоматически рассчитает суммарное время дороги и ожидания $T = T_{{дорога}} + T_{{очередь}}$, чтобы сэкономить ваше время!"
                    ),
                    "sources": [{"title": "Интерактивная карта и умная маршрутизация", "category": "Навигация"}],
                    "cards": []
                }
            else:
                return {
                    "text": (
                        "📍 Геолокация еще определяется вашим браузером. Пожалуйста, разрешите доступ к местоположению в браузере, "
                        "и я сразу покажу ближайшее к вам отделение Почты России и расстояние до него!"
                    ),
                    "sources": [{"title": "Интерактивная карта отделений", "category": "Навигация"}],
                    "cards": []
                }

        # Intent C: Active Tickets in Personal Cabinet
        is_tickets_query = state.get("is_ticket_inquiry") or any(
            w in q_lower for w in [
                "какие у меня талоны", "мои талоны", "мои записи", "список талонов", "какой у меня талон",
                "расксажи про мои талоны", "расскажи про мои талоны", "проверь мои талоны", "покажи мои талоны",
                "мои активные талоны", "талоны"
            ]
        )
        if is_tickets_query:
            active_tickets = context.get("active_tickets") or []
            existing_pending = state.get("existing_pending")
            pending_hint = ""
            if existing_pending:
                pending_hint = (
                    f"\n\n💡 *Обратите внимание: у вас ожидает подтверждения запись в {existing_pending.get('branchName', 'отделение')} "
                    f"на {existing_pending.get('scheduledText', 'выбранное время')}. "
                    f"Если хотите завершить запись и выпустить этот талон, просто напишите «Да» (или «Отмена»).*"
                )

            if active_tickets:
                lines = [f"🎫 **Ваши активные талоны в Личном кабинете ({len(active_tickets)} шт.):**\n"]
                for idx, t in enumerate(active_tickets, 1):
                    t_num = t.get("number") or "Талон"
                    t_srv = t.get("serviceName") or "Почтовые услуги"
                    t_st = t.get("status") or "WAITING"
                    status_text = "⏳ Ожидание в очереди" if t_st == "WAITING" else ("🔔 Вас вызывают к окну!" if t_st == "CALLED" else t_st)
                    lines.append(f"{idx}. Талон **{t_num}** — «{t_srv}» ({status_text})")
                lines.append("\nВсе талоны привязаны к вашему профилю. Вы можете отслеживать их статус в разделе **«Мои талоны»**.")
                lines.append(pending_hint)
                return {
                    "text": "\n".join(lines).strip(),
                    "sources": [{"title": "Личный кабинет и раздел «Мои талоны»", "category": "Сервис"}],
                    "cards": []
                }
            elif context.get("ticket_id"):
                ticket_id = context.get("ticket_id")
                details = await backend_client.get_ticket_details(ticket_id)
                if details and details.get("ticket") and details["ticket"].get("status") not in ["COMPLETED", "CANCELLED", "NO_SHOW"]:
                    t = details["ticket"]
                    pos = details.get("position", {})
                    eta = details.get("eta", {})
                    pos_num = pos.get("position")
                    pos_text = f"Перед вами в очереди: **{pos_num} чел.**" if pos_num is not None else "Вы в начале очереди."
                    eta_val = eta.get("estimatedWaitSeconds") or eta.get("predictedEtaSeconds")
                    eta_text = f"Примерное время ожидания: **~{round(eta_val / 60)} мин.**" if eta_val else "Ожидание: **менее 5 мин.**"
                    t_text = (
                        f"🎫 **Ваш активный талон в Личном кабинете:**\n\n"
                        f"- Номер талона: **{t.get('publicNumber', 'Талон')}**\n"
                        f"- Услуга: «{t.get('serviceName', 'Почтовые услуги')}»\n"
                        f"- Статус: **{t.get('status', 'WAITING')}**\n"
                        f"- {pos_text}\n"
                        f"- {eta_text}\n\n"
                        f"Талон доступен в разделе **«Мои талоны»**."
                        f"{pending_hint}"
                    )
                    return {
                        "text": t_text.strip(),
                        "sources": [{"title": "Личный кабинет и раздел «Мои талоны»", "category": "Сервис"}],
                        "cards": []
                    }
                else:
                    return {
                        "text": (
                            "🎫 В вашем Личном кабинете сейчас **нет активных талонов**.\n\n"
                            "Все предыдущие талоны уже обслужены или завершены. "
                            "Вы можете взять новый талон прямо в этом диалоге!"
                            f"{pending_hint}"
                        ).strip(),
                        "sources": [{"title": "Личный кабинет", "category": "Сервис"}],
                        "cards": []
                    }
            else:
                return {
                    "text": (
                        "🎫 В вашем Личном кабинете сейчас **нет активных талонов**.\n\n"
                        "Вы можете взять талон прямо здесь в чате (просто напишите, например: *«Запиши меня на отправку посылки»*) "
                        "или на главной странице сайта."
                        f"{pending_hint}"
                    ).strip(),
                    "sources": [{"title": "Личный кабинет", "category": "Сервис"}],
                    "cards": []
                }

        # Intent D: Branch details, schedule, or location follow-up (Context Aware)
        is_branch_query = any(w in q_lower for w in [
            "как работает", "до скольки", "график", "часы работы", "адрес", "где находится",
            "как добраться", "какое метро", "где оно", "как доехать", "режим работы", "расписание"
        ])
        if is_branch_query and current_branch:
            return {
                "text": (
                    f"🏢 **Информация об отделении «{current_branch['name']}»:**\n\n"
                    f"📮 **Адрес:** {current_branch['address']}\n"
                    f"🚇 **Метро рядом:** {current_branch.get('metro', 'ближайшая станция метро')}\n"
                    f"🕒 **График работы:**\n"
                    f"• Понедельник – Пятница: 08:00 – 20:00 (без перерыва)\n"
                    f"• Суббота: 09:00 – 18:00\n"
                    f"• Воскресенье: 09:00 – 14:00\n\n"
                    f"💡 Вы можете оформить талон ко времени в это отделение прямо здесь в диалоге!"
                ),
                "sources": [{"title": f"Отделение {current_branch['name']}", "category": "Отделения"}],
                "cards": []
            }

        # Intent E: Website Overview & Capabilities
        if any(w in q_lower for w in ["что умеет сайт", "о сайте", "возможности сайта", "разделы сайта", "как работает сайт", "что тут есть", "расскажи о сайте"]):
            return {
                "text": (
                    "🌐 **Цифровая платформа Почты России нового поколения объединяет:**\n\n"
                    "1. 🎫 **Электронная очередь & Онлайн-запись:**\n"
                    "   - Оформление талона в живую очередь в 1 клик или прямо в этом чате;\n"
                    "   - Предварительная онлайн-запись на выбранную дату и время без очереди.\n\n"
                    "2. 🗺️ **Интерактивная карта & Smart Routing:**\n"
                    "   - Алгоритм $T = T_{дорога} + T_{очередь}$ подбирает отделение, где вас обслужат быстрее всего;\n"
                    "   - Geofencing (75 м): автоопределение прибытия в отделение по GPS.\n\n"
                    "3. 📱 **Личный кабинет и раздел «Мои талоны»:**\n"
                    "   - Привязка всех ваших талонов, отслеживание ETA и позиции в очереди в реальном времени;\n"
                    "   - Звуковой гонг и системные Web Push уведомления при вызове к окну;\n"
                    "   - Оповещения через официального Telegram-бота (@poiters_inno_bot) и SMS.\n\n"
                    "4. ⭐ **Контроль качества & История:**\n"
                    "   - Оценка работы оператора от 1 до 5 звезд после завершения обслуживания;\n"
                    "   - Сохранение истории посещений (окно, оператор, время визита).\n\n"
                    "5. 📺 **Информационные табло:** страницы `/board` и `/tv` для залов ожидания с озвучкой вызовов.\n\n"
                    "Чем я могу помочь вам прямо сейчас?"
                ),
                "sources": [{"title": "Возможности, разделы и сервисы веб-платформы Почты России", "category": "Веб-платформа"}],
                "cards": []
            }

        # Intent F: Check Specific Ticket Status
        status_keywords = ["мой талон", "статус талона", "сколько ждать", "какой в очереди", "позиция в очереди", "где мой талон"]
        if any(w in q_lower for w in status_keywords):
            ticket_id = context.get("ticket_id")
            if ticket_id:
                details = await backend_client.get_ticket_details(ticket_id)
                if details and details.get("ticket"):
                    t = details["ticket"]
                    pos = details.get("position", {})
                    eta = details.get("eta", {})

                    pos_num = pos.get("position")
                    pos_text = f"Перед вами в очереди: **{pos_num} чел.**" if pos_num is not None else "Вы в начале очереди."
                    eta_val = eta.get("estimatedWaitSeconds") or eta.get("predictedEtaSeconds")
                    eta_text = f"Примерное время ожидания: **~{round(eta_val / 60)} мин.**" if eta_val else "Ожидание: **менее 5 мин.**"

                    cards.append({"type": "ticket_status", "data": details})
                    return {
                        "text": (
                            f"🎫 **Информация по вашему талону {t.get('publicNumber', '')}:**\n\n"
                            f"- **Статус:** {t.get('status', 'WAITING')}\n"
                            f"- **Услуга:** {t.get('serviceName', 'Почтовые услуги')}\n"
                            f"- {pos_text}\n"
                            f"- {eta_text}\n\n"
                            f"🔔 Когда ваш номер загорится на центральном табло, подойдите к назначенному окну!"
                        ),
                        "sources": [{"title": "Электронная цифровая очередь", "category": "Сервис"}],
                        "cards": cards
                    }
                else:
                    return {
                        "text": "Я вижу идентификатор талона, но не смог получить свежие данные из системы. Возможно, талон уже завершён или отменён.",
                        "sources": [],
                        "cards": []
                    }
            else:
                return {
                    "text": "У вас пока нет активного талона в текущей сессии. Вы можете взять талон прямо здесь, просто напишите: *«Запиши меня в очередь»*!",
                    "sources": [],
                    "cards": []
                }

        # Intent G: Knowledge Base Hybrid RAG Search
        retrieved = self.kb.search(query, top_k=3)
        if retrieved:
            sources = [{"title": r["title"], "category": r["category"]} for r in retrieved]
            top_match = retrieved[0]
            answer = f"### {top_match['title']}\n\n{top_match['content']}\n\n"
            if len(retrieved) > 1 and retrieved[1]["score"] > 1.2:
                sec = retrieved[1]
                answer += f"**Также полезно знать ({sec['title']}):**\n{sec['summary']}\n\n"

            answer += "💡 *Если вам нужно взять талон или проверить время ожидания, напишите мне в любой момент!*"
            return {
                "text": answer,
                "sources": sources,
                "cards": []
            }

        # Intent H: General fallback response
        greeting_prefix = f"Здравствуйте, {user_name}! " if user_name else "Здравствуйте! "
        return {
            "text": (
                f"{greeting_prefix}Я официальный цифровой ассистент Почты России.\n\n"
                "Я могу помочь вам:\n"
                "- 📦 Узнать правила отправки посылок, писем и требования к упаковке;\n"
                "- 🚫 Уточнить список запрещенных к пересылке предметов;\n"
                "- 🪪 Рассказать, как получать посылки без паспорта по коду из SMS (ПЭП);\n"
                "- 🎫 Проверить статус вашего талона в Личном кабинете;\n"
                "- 📍 Подсказать ближайшее отделение и рассчитать самый быстрый маршрут;\n"
                "- ⏱️ Оформить талон в очередь прямо в этом диалоге.\n\n"
                "О чем бы вы хотели узнать?"
            ),
            "sources": [],
            "cards": []
        }
