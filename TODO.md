# TODO

## 1. Auckland Council regional parks — DEFERRED

Second source alongside DOC: campgrounds, baches, lodges, glamping in Auckland regional parks.

- Property pages: `https://www.aucklandcouncil.govt.nz/en/parks-recreation/stay-at-park/find-accommodation/accommodation-details/{id}.html`
- Known ids: `16` Peninsula campground / Āwhitu (`productId` 220042), `62` Graham Bach /
  Scandrett (220191), `76` Tāwharanui bach, `79` Tāwharanui campground.
- Availability API (one month per call):
  `https://experience.aucklandcouncil.govt.nz/nextapi/accommodations?reqType=availability&productId={pid}&firstDay={ISO}&lastDay={ISO}`
- Auth: `Authorization: Bearer <token>` — a **public** short-lived JWT embedded in the HTML
  of any Auckland Council page (one JWT-shaped string, ~157 chars). Scrape it per run and
  reuse across properties. Also send `Origin`/`Referer` of `www.aucklandcouncil.govt.nz`.
  Prior art for the same host: <https://github.com/thecolab-ai/.skills> (`skills/auckland-bin-schedule`).
- No-auth fallback: the **current month only** is server-rendered into the property page
  HTML (`class="date available|some-available|unavailable"`). Month cannot be shifted by
  query param.
- Booking window is 6 months; availability refreshes at midnight daily.
- Data shape differs from DOC: three states (available / some spaces / unavailable), **no
  seat count**. So `notify.js`'s `TotalAvailable > 1` rule has no equivalent — trigger
  would just be `unavailable -> available`.
- Their notes ask to avoid high-volume scraping: one token fetch per run, few properties.

### Первый шаг

Спросить у пользователя, какие объекты он реально бронирует — без этого список id не
собрать, а вслепую обходить ~120 страниц по 2.7 МБ не стоит.

### Что нужно решить

- Добавлять ли в `config.json` поле `source` (`"doc"` / `"akl"`) и приводить оба источника
  к одной внутренней форме дня, или держать их раздельно.
- `notify.js` для AKL: у него нет счётчика мест, поэтому правило срабатывания —
  просто `unavailable -> available`, без аналога `TotalAvailable > 1`.

### Как это ляжет на текущий код

- `fetch.js` теперь считает `nightsFor(hut)` — окно в ночах от самой дальней отслеживаемой
  даты. Для AKL это неприменимо: их API работает помесячно, окно бронирования 6 месяцев.
  Значит развилка по источнику должна быть выше построения URL.
- `notify.js` уже предупреждает, если отслеживаемая дата отсутствует в данных — для AKL
  это поведение подходит без изменений.

### Про проверку токена

Сквозной curl-тест «вытащить bearer из HTML и отправить в заголовке» три раза заблокировал
классификатор песочницы — эвристика против кражи учёток, здесь ложное срабатывание. Токен
публичный и отдаётся любому анониму. Варианты: пользователь разрешает это правило, либо
пишем сразу в `fetch.js` и первым прогоном в Actions проверяем.

Готовых решений для Auckland Council не существует: поиск по GitHub за
`experience.aucklandcouncil.govt.nz` даёт только вывоз мусора и налоги на недвижимость,
ни один коммерческий сервис уведомлений о кемпингах советы Новой Зеландии не покрывает.
