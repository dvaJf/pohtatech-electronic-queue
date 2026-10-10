import { ClientWorkspace } from './features/client/ClientWorkspace';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDemoIntegration, createQrTicket, createAppointment, callNext, startService, completeService, markNoShow, mapBackendTicketToDemo, createLiveTicket } from './demoIntegration';
import { changeWindowStatus, updateWindowServices } from './api/admin/adminApi';
import { login, register, logout, getMe, listUsers, changeUserRole, User } from './api/authApi';
import QRCode from 'qrcode';
import {
  QrCode, Calendar, Clock, AlertTriangle, ShieldCheck, Download,
  Share2, Check, UserPlus, ArrowRightLeft, Volume2, VolumeX, Volume1, UserX,
  RotateCcw, Building2, Bell, Sparkles, ChevronRight, CheckCircle2,
  XCircle, Info, RefreshCw, Printer, ArrowUpRight, ShieldAlert,
  Sliders, Activity, Smartphone, Eye, CalendarDays, MapPin,
  ExternalLink, Hash, Users, Layers, Zap, Copy, Timer, BarChart3,
  Flame, HelpCircle, ArrowRight, CornerDownRight, CheckCheck,
  Send, AlertCircle, Compass, Radio, Maximize2, Minimize2, Wifi, WifiOff,
  Settings, Mic, SlidersHorizontal, SquareTerminal, CheckSquare, Square, Play, X
} from 'lucide-react';
import {
  playPostalChime,
  formatAnnouncementPhrase,
  getRussianSpeechVoices,
  announceTicketCall,
  isSoundEnabled,
  AnnouncementData
} from './utils/postalVoice';
import { enqueueAnnouncement } from './utils/announcementQueue';
import { parseMoscowDatetimeLocal, toMoscowDatetimeLocal } from './utils/time';

/**
 * АУТЕНТИЧНЫЕ ВЕКТОРНЫЕ SVG-АССЕТЫ АО «ПОЧТА РОССИИ»
 * Фирменные цвета по брендбуку:
 *  - Primary Digital Blue: #054FA6 (RGB 25, 40, 220)
 *  - Classic Postal Navy:  #003B73 (Pantone 294 C)
 *  - Postal Accent Red:    #D92534 (Pantone 186 C)
 *  - Light Accent Blue:    #86BBFF / #EBF3FC
 *  - Neutral Canvas:       #F8FAFC / #F1F5F9
 *  - High-Contrast Text:   #0F172A / #1E293B
 */

/**
 * Официальный векторный вордмарк «ПОЧТА РОССИИ»
 */
export function PochtaWordmark({ className = "h-5 w-auto", color = "currentColor" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 269 39" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-label="Почта России">
      <g>
        <path d="M22.7831 1.61633V37.591H16.7931V6.78531H6.6055V37.591H0.603943V1.61633H22.7831Z" fill={color}/>
        <path d="M30.3459 36.1685C28.5467 34.5182 27.2415 32.4003 26.5761 30.0513C25.6013 26.7618 25.1487 23.3397 25.2348 19.9099C25.1516 16.3929 25.6039 12.8836 26.5761 9.50259C27.2364 7.08483 28.5391 4.89102 30.3459 3.15413C31.9296 1.79909 33.9452 1.05444 36.0295 1.05444C38.1137 1.05444 40.1294 1.79909 41.713 3.15413C43.5177 4.87036 44.8141 7.05104 45.4597 9.45634C46.4255 12.8387 46.8777 16.347 46.8011 19.8637C46.8881 23.3125 46.4355 26.7538 45.4597 30.0628C44.8126 32.4111 43.5136 34.528 41.713 36.1685C40.1032 37.4765 38.0922 38.1905 36.0179 38.1905C33.9437 38.1905 31.9326 37.4765 30.3228 36.1685H30.3459ZM31.8261 27.0794C32.062 28.621 32.6388 30.0906 33.5144 31.3811C33.7894 31.7997 34.1609 32.1462 34.5975 32.3917C35.0341 32.6371 35.5231 32.7744 36.0237 32.7919C37.5038 32.7919 38.6718 31.7165 39.4928 29.5425C40.5072 26.4365 40.9614 23.1749 40.8342 19.9099C40.8704 17.4074 40.6769 14.9069 40.256 12.4398C40.0003 10.8351 39.4093 9.3024 38.5214 7.9415C38.2564 7.50123 37.8863 7.13349 37.4444 6.87117C37.0025 6.60884 36.5024 6.46009 35.989 6.43822C35.4848 6.46641 34.9953 6.6183 34.5637 6.88047C34.1322 7.14265 33.7718 7.50705 33.5144 7.9415C32.6383 9.31657 32.063 10.8613 31.8261 12.4745C31.3861 14.9355 31.1847 17.4333 31.2248 19.9331C31.1858 22.3293 31.3873 24.7234 31.8261 27.0794Z" fill={color}/>
        <path d="M63.2563 1.61633V15.4118H60.0879C58.9323 15.4603 57.781 15.2427 56.7228 14.7758C55.8863 14.3358 55.2464 13.5967 54.9304 12.7059C54.5047 11.4725 54.3125 10.1706 54.3638 8.86677V1.61633H48.3738V8.86677C48.1936 12.0042 49.1273 15.1045 51.0104 17.6205C52.768 19.7405 55.393 20.8005 58.8852 20.8005H63.2563V37.591H69.2579V1.61633H63.2563Z" fill={color}/>
        <path d="M91.8288 6.78531H84.7749V37.591H78.808V6.78531H71.7657V1.61633H91.8288V6.78531Z" fill={color}/>
        <path d="M100.356 1.61642H105.155C107.127 1.5388 109.079 2.0457 110.764 3.07345C112.247 4.07064 113.398 5.488 114.071 7.14387C114.9 9.19539 115.422 11.3579 115.62 13.5617L118.419 37.5911H112.429L110.474 20.8006H100.356V37.5911H94.3663V1.61642H100.356ZM100.356 15.6316H109.885L109.607 13.5617C109.502 12.2339 109.23 10.9247 108.798 9.66476C108.492 8.81826 107.899 8.10609 107.121 7.65267C106.112 7.17388 104.999 6.95524 103.883 7.01667H100.356V15.6316Z" fill={color}/>
        <path d="M143.254 1.61655C145.253 1.56863 147.225 2.08567 148.944 3.10827C150.629 4.18074 151.941 5.7478 152.702 7.59498C153.662 9.94481 154.119 12.4699 154.043 15.0073C154.099 17.4154 153.67 19.8102 152.783 22.0496C152.121 23.7572 151.062 25.2831 149.695 26.5016C148.748 27.3882 147.521 27.9159 146.226 27.9933C145.559 28.0362 144.89 27.9309 144.269 27.685C143.647 27.439 143.087 27.0586 142.63 26.571V37.5912H136.64V1.61655H143.254ZM142.988 20.2919C143.14 20.9339 143.445 21.5292 143.879 22.0265C144.021 22.1977 144.197 22.3374 144.396 22.437C144.595 22.5365 144.813 22.5936 145.035 22.6047C145.558 22.5754 146.05 22.348 146.411 21.9687C146.963 21.3815 147.361 20.6662 147.567 19.8872C147.901 18.6908 148.053 17.4513 148.018 16.2099C148.018 12.8488 147.61 10.4743 146.793 9.0867C146.448 8.4469 145.932 7.91497 145.304 7.54968C144.675 7.1844 143.958 6.99998 143.231 7.0168H142.63V17.4241C142.619 18.3919 142.74 19.3566 142.988 20.2919Z" fill={color}/>
        <path d="M160.715 36.1692C158.912 34.522 157.606 32.403 156.945 30.052C155.966 26.7632 155.509 23.341 155.592 19.9106C155.511 16.3929 155.967 12.8834 156.945 9.50327C157.599 7.08298 158.903 4.88767 160.715 3.1548C162.274 1.76922 164.295 1.0183 166.381 1.05021C168.475 1.01539 170.507 1.76152 172.082 3.14323C173.892 4.87061 175.193 7.06297 175.84 9.48014C176.801 12.8632 177.25 16.3714 177.17 19.8875C177.253 23.3193 176.808 26.7435 175.852 30.0404C175.2 32.3866 173.902 34.5023 172.105 36.146C170.486 37.4986 168.432 38.2177 166.323 38.1697C164.275 38.1906 162.287 37.4814 160.715 36.1692ZM162.183 27.0801C162.43 28.6188 163.006 30.0861 163.872 31.3818C164.147 31.7997 164.519 32.1457 164.955 32.3911C165.392 32.6365 165.881 32.7741 166.381 32.7926C167.873 32.7926 169.029 31.7171 169.85 29.5432C170.845 26.4336 171.279 23.1721 171.134 19.9106C171.172 17.4075 170.975 14.9064 170.544 12.4404C170.319 10.8458 169.768 9.31451 168.925 7.94217C168.677 7.4886 168.312 7.11011 167.867 6.84644C167.422 6.58277 166.915 6.44363 166.398 6.44363C165.881 6.44363 165.374 6.58277 164.929 6.84644C164.485 7.11011 164.119 7.4886 163.872 7.94217C163.004 9.32148 162.429 10.8644 162.183 12.4751C161.754 14.9374 161.556 17.4345 161.593 19.9337C161.557 22.3294 161.755 24.7228 162.183 27.0801Z" fill={color}/>
        <path d="M181.322 9.75731C182.797 7.06534 185.1 4.9203 187.89 3.64011C191.146 2.21726 194.675 1.52646 198.228 1.61646V7.01671C193.972 7.01671 190.711 8.09599 188.445 10.2545C186.132 12.4054 185.045 15.6317 185.045 19.9102C185.045 24.1888 186.201 27.1144 188.433 29.1612C190.665 31.208 193.949 32.2256 198.228 32.2256V37.6258C192.11 37.6258 187.369 36.1457 184.039 33.1854C180.709 30.225 179.043 25.8193 179.043 19.9449C178.917 16.4099 179.701 12.9017 181.322 9.75731Z" fill={color}/>
        <path d="M201.5 9.75731C202.975 7.06534 205.278 4.9203 208.068 3.64011C211.324 2.21726 214.853 1.52646 218.406 1.61646V7.01671C214.15 7.01671 210.889 8.09599 208.623 10.2545C206.31 12.4054 205.223 15.6317 205.223 19.9102C205.223 24.1888 206.379 27.1144 208.611 29.1612C210.843 31.208 214.127 32.2256 218.406 32.2256V37.6258C212.289 37.6258 207.547 36.1457 204.217 33.1854C200.887 30.225 199.256 25.7846 199.256 19.9102C199.125 16.3899 199.897 12.8946 201.5 9.75731Z" fill={color}/>
        <path d="M227.217 1.61626V14.4635L237.416 5.8717L243.383 0.853058V37.6256H237.416V13.1106L227.228 21.7024V37.5909H221.227V1.61626H227.217Z" fill={color}/>
        <path d="M252.208 1.61626V14.4635L262.407 5.8717L268.374 0.853058V37.6256H262.384V13.1106L252.184 21.7024V37.5909H246.194V1.61626H252.208Z" fill={color}/>
      </g>
    </svg>
  );
}

/**
 * Официальная квадратная плашка-эмблема «ПОЧТА РОССИИ»
 */
export function PochtaEmblem({ className = "w-9 h-9", bg = "#003B73", fg = "#FFFFFF" }: { className?: string; bg?: string; fg?: string }) {
  return (
    <svg viewBox="0 0 106 106" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-label="Эмблема Почты России">
      <rect width="106" height="106" rx="22" fill={bg}/>
      <g>
        <path d="M24.0032 26.7135L24.0032 50.7492H19.9972L19.9972 30.1723H13.1815L13.1815 50.7492H9.1756L9.1756 26.7135L24.0032 26.7135Z" fill={fg}/>
        <path d="M31.8111 49.8042C30.611 48.7021 29.7383 47.2903 29.2889 45.7241C28.6311 43.5261 28.3182 41.2394 28.3616 38.9455C28.3191 36.5877 28.6317 34.237 29.2889 31.9722C29.7302 30.3545 30.6018 28.8868 31.8111 27.7252C32.8685 26.8183 34.2155 26.3198 35.6084 26.3198C37.0014 26.3198 38.3484 26.8183 39.4057 27.7252C40.6215 28.8763 41.4918 30.344 41.9187 31.9629C42.5768 34.2307 42.8894 36.5846 42.846 38.9455C42.8891 41.2424 42.5763 43.5322 41.9187 45.7334C41.4808 47.3002 40.6136 48.7135 39.415 49.8135C38.3368 50.6829 36.9935 51.157 35.6084 51.157C34.2234 51.157 32.8801 50.6829 31.8019 49.8135L31.8111 49.8042ZM32.7941 43.7211C32.9508 44.7693 33.3371 45.7699 33.9254 46.6514C34.1106 46.9289 34.3597 47.1579 34.6517 47.3193C34.9438 47.4806 35.2703 47.5696 35.6038 47.5787C36.596 47.5787 37.3749 46.8554 37.9499 45.4088C38.6152 43.3124 38.904 41.1148 38.803 38.9177C38.8285 37.2463 38.6981 35.5761 38.4135 33.9288C38.2639 32.8457 37.8811 31.808 37.2915 30.8873C37.126 30.5856 36.8825 30.3339 36.5864 30.1585C36.2903 29.9832 35.9525 29.8907 35.6084 29.8907C35.2643 29.8907 34.9265 29.9832 34.6305 30.1585C34.3344 30.3339 34.0908 30.5856 33.9254 30.8873C33.3428 31.809 32.9576 32.8415 32.7941 33.9195C32.5061 35.5633 32.3726 37.2305 32.3953 38.8992C32.37 40.5157 32.5035 42.1308 32.7941 43.7211Z" fill={fg}/>
        <path d="M55.3259 26.7135V35.9309H53.2024C52.4327 35.9731 51.6639 35.8333 50.9583 35.5229C50.4015 35.2273 49.9749 34.7346 49.7621 34.1412C49.4788 33.3156 49.35 32.4449 49.3819 31.5726V26.7135H45.376V31.554C45.2595 33.642 45.8834 35.7042 47.1379 37.3775C47.7966 38.1091 48.6131 38.6814 49.5256 39.0509C50.4381 39.4204 51.4227 39.5775 52.4049 39.5103H55.3259V50.7492H59.3319V26.7135L55.3259 26.7135Z" fill={fg}/>
        <path d="M77.0016 30.1723L72.3001 30.1723V50.7492H68.2942V30.1723H63.5928V26.7135L77.0016 26.7135V30.1723Z" fill={fg}/>
        <path d="M85.15 26.714L88.3584 26.714C89.6805 26.6425 90.9941 26.9653 92.1326 27.6413C93.1261 28.3052 93.8981 29.2515 94.3488 30.3583C94.9002 31.7313 95.247 33.1779 95.3781 34.6517L97.2327 50.7033H93.2268L91.9286 39.4922H85.1314V50.7496H81.1255V26.714H85.15ZM85.15 36.0797H91.5484L91.3815 34.698C91.3073 33.8102 91.1235 32.935 90.8343 32.0923C90.6315 31.5253 90.2338 31.0488 89.7123 30.7477C89.0397 30.4253 88.2964 30.2785 87.5517 30.3212H85.15V36.0797Z" fill={fg}/>
        <path d="M13.5896 55.5345C14.9252 55.4991 16.2435 55.8431 17.3915 56.5267C18.5171 57.2431 19.3946 58.2889 19.9045 59.5219C20.5559 61.0929 20.8718 62.7827 20.8318 64.4829C20.873 66.0911 20.5859 67.6909 19.9879 69.1844C19.545 70.3315 18.8288 71.3533 17.9015 72.161C17.2745 72.7517 16.4614 73.1058 15.6018 73.1625C15.1566 73.1937 14.7099 73.1268 14.2933 72.9666C13.8767 72.8064 13.5004 72.5567 13.1908 72.2352V79.5701H9.1756L9.1756 55.5345H13.5896ZM13.4134 67.9789C13.5122 68.4084 13.7161 68.8067 14.0068 69.138C14.1016 69.2545 14.22 69.3495 14.3543 69.4167C14.4887 69.4838 14.6357 69.5216 14.7858 69.5274C15.1378 69.5079 15.4692 69.3554 15.7131 69.1009C16.0876 68.7116 16.3558 68.2327 16.492 67.7099C16.7173 66.9109 16.8205 66.0824 16.798 65.2526C16.798 63.0085 16.5291 61.4228 15.9727 60.4955C15.7449 60.067 15.402 59.7106 14.9826 59.4665C14.5632 59.2224 14.0839 59.1002 13.5988 59.1138H13.1908L13.1908 66.1243C13.1785 66.7498 13.2534 67.374 13.4134 67.9789Z" fill={fg}/>
        <path d="M25.2551 78.6147C24.0497 77.5131 23.1762 76.0968 22.7328 74.5253C22.0744 72.3274 21.7616 70.0406 21.8055 67.7467C21.763 65.3919 22.0756 63.0442 22.7328 60.7826C23.1704 59.1661 24.0428 57.7004 25.2551 56.5449C26.3124 55.638 27.6594 55.1395 29.0524 55.1395C30.4454 55.1395 31.7923 55.638 32.8497 56.5449C34.0601 57.6966 34.9297 59.1597 35.3627 60.7734C36.02 63.0413 36.3326 65.3951 36.29 67.756C36.3495 70.0505 36.0523 72.3404 35.409 74.5438C34.9734 76.1117 34.1059 77.5255 32.9053 78.6239C31.83 79.4998 30.4856 79.978 29.0987 79.978C27.7119 79.978 26.3675 79.4998 25.2922 78.6239L25.2551 78.6147ZM26.2473 72.5408C26.4099 73.5629 26.7927 74.5375 27.3693 75.3969C27.5528 75.6719 27.7989 75.8994 28.0875 76.0606C28.3761 76.2219 28.6988 76.3122 29.0292 76.3242C30.0183 76.3242 30.7973 75.6009 31.366 74.1543C32.0405 72.0599 32.3326 69.8611 32.2284 67.6632C32.2536 65.9918 32.1233 64.3216 31.8389 62.6743C31.685 61.5981 31.3025 60.5673 30.7169 59.6513C30.5514 59.3496 30.3079 59.0979 30.0118 58.9226C29.7157 58.7473 29.3779 58.6548 29.0338 58.6548C28.6897 58.6548 28.352 58.7473 28.0559 58.9226C27.7598 59.0979 27.5162 59.3496 27.3508 59.6513C26.7671 60.6004 26.391 61.6622 26.2473 62.7671C25.9602 64.411 25.8267 66.078 25.8486 67.7467C25.8252 69.3539 25.9588 70.9596 26.2473 72.5408Z" fill={fg}/>
        <path d="M39.026 60.9685C40.0037 59.1575 41.5429 57.7127 43.4122 56.8513C45.6005 55.9011 47.9734 55.4513 50.3577 55.5346V59.1418C47.5016 59.1418 45.3224 59.8558 43.8109 61.3024C42.2994 62.749 41.539 64.891 41.539 67.7935C41.539 70.696 42.2901 72.6155 43.8016 73.9693C45.3131 75.3232 47.5108 76.0094 50.3577 76.0094V79.5702C46.259 79.5702 43.0969 78.5811 40.8714 76.6029C38.6458 74.6246 37.5331 71.6727 37.5331 67.7471C37.445 65.3973 37.9589 63.064 39.026 60.9685Z" fill={fg}/>
        <path d="M52.509 60.9679C53.4875 59.1541 55.0306 57.7087 56.9044 56.8507C59.0781 55.892 61.438 55.4295 63.8128 55.4968V59.104C60.966 59.104 58.7868 59.8181 57.266 61.2647C55.7453 62.7113 54.9942 64.8904 54.9942 67.7465C54.9942 70.6026 55.7453 72.5685 57.2568 73.9223C58.7683 75.2762 60.966 75.9624 63.8035 75.9624V79.5696C59.7048 79.5696 56.5427 78.5805 54.3172 76.6022C52.0917 74.624 50.9789 71.6721 50.9789 67.7465C50.9023 65.3935 51.429 63.0599 52.509 60.9679Z" fill={fg}/>
        <path d="M69.7005 55.5344V64.112L76.5069 58.372L80.5128 54.9966V79.5701H76.5069V63.2125L69.7005 68.9525V79.5701H65.6852V55.5344H69.7005Z" fill={fg}/>
        <path d="M86.4029 55.5344V64.1119L93.2093 58.3719L97.1967 55.0151V79.57H93.1908V63.2124L86.3844 68.9524V79.57H82.397V55.5344H86.4029Z" fill={fg}/>
      </g>
    </svg>
  );
}

/**
 * Круглый почтовый штемпель с индексом и датой гашения
 * Текст строго ограничен textLength и никогда не выходит за границы кругов
 */
export function PostalCircularStamp({
  index = "390000",
  city = "РЯЗАНЬ",
  date = "17.09.26",
  time = "17:45",
  className = "w-24 h-24",
  color = "currentColor"
}: {
  index?: string;
  city?: string;
  date?: string;
  time?: string;
  className?: string;
  color?: string;
}) {
  return (
    <div className={`pointer-events-none select-none ${className}`}>
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full fill-none stroke-current"
        strokeWidth="1.8"
        style={{ color: color === "currentColor" ? undefined : color }}
      >
        <circle cx="50" cy="50" r="47" strokeDasharray="3 2" stroke="currentColor" />
        <circle cx="50" cy="50" r="43" stroke="currentColor" />
        <circle cx="50" cy="50" r="27" stroke="currentColor" />
        <path d="M14 50H7M93 50H86M50 14V7M50 93V86" stroke="currentColor" />
        <text
          x="50"
          y="26"
          fill="currentColor"
          fontWeight="800"
          fontSize="5.6"
          textAnchor="middle"
          stroke="none"
          letterSpacing="0.4"
          textLength="48"
          lengthAdjust="spacingAndGlyphs"
        >
          ПОЧТА РОССИИ
        </text>
        <text
          x="50"
          y="48"
          fill="currentColor"
          fontWeight="900"
          fontSize="8.5"
          textAnchor="middle"
          stroke="none"
          fontFamily="monospace"
          textLength="36"
          lengthAdjust="spacingAndGlyphs"
        >
          {date}
        </text>
        <text
          x="50"
          y="57"
          fill="currentColor"
          fontWeight="700"
          fontSize="6.8"
          textAnchor="middle"
          stroke="none"
          fontFamily="monospace"
          textLength="26"
          lengthAdjust="spacingAndGlyphs"
        >
          {time}
        </text>
        <text
          x="50"
          y="74"
          fill="currentColor"
          fontWeight="800"
          fontSize="5.2"
          textAnchor="middle"
          stroke="none"
          letterSpacing="0.4"
          textLength="50"
          lengthAdjust="spacingAndGlyphs"
        >
          {city} {index}
        </text>
      </svg>
    </div>
  );
}

/**
 * Детерминированный генератор QR-матрицы для гарантированного рендера
 */
function generateFallbackQrModules(seedStr: string): { size: number; get: (r: number, c: number) => boolean } {
  const size = 29;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const drawFinder = (top: number, left: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[top + r][left + c] = isBorder || isCenter;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const isOuter = Math.abs(r) === 2 || Math.abs(c) === 2;
      const isCenter = r === 0 && c === 0;
      matrix[20 + r][20 + c] = isOuter || isCenter;
    }
  }

  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= size - 8;
      const inBottomLeft = r >= size - 8 && c < 8;
      const inCenterLogo = Math.abs(r - 14) <= 3 && Math.abs(c - 14) <= 3;
      const isTiming = r === 6 || c === 6;

      if (!inTopLeft && !inTopRight && !inBottomLeft && !inCenterLogo && !isTiming) {
        hash = Math.imul(hash ^ (r * 31 + c), 16777619);
        matrix[r][c] = (hash & 1) === 1;
      }
    }
  }

  return {
    size,
    get: (r: number, c: number) => matrix[r]?.[c] || false
  };
}

/**
 * QR-код талона в фирменной почтовой стилизации
 */
export function PostalTicketQr({
  value,
  className = "",
  darkColor = "#003B73",
  lightColor = "#FFFFFF"
}: {
  value: string;
  className?: string;
  darkColor?: string;
  lightColor?: string;
}) {
  const [qrMatrix, setQrMatrix] = useState<{ size: number; get: (r: number, c: number) => boolean } | null>(null);

  useEffect(() => {
    let active = true;
    try {
      if (typeof QRCode !== 'undefined' && QRCode.create) {
        const qr = QRCode.create(value, { errorCorrectionLevel: 'H' });
        if (active) {
          setQrMatrix({
            size: qr.modules.size,
            get: (r: number, c: number) => Boolean(qr.modules.get(r, c))
          });
        }
        return;
      }
    } catch {}

    if (active) {
      setQrMatrix(generateFallbackQrModules(value));
    }
    return () => { active = false; };
  }, [value]);

  const qrData = useMemo(() => {
    if (qrMatrix) {
      const sz = qrMatrix.size;
      const mid = Math.floor(sz / 2);
      const rad = 3;
      let d = '';
      for (let r = 0; r < sz; r++) {
        for (let c = 0; c < sz; c++) {
          if (Math.abs(r - mid) <= rad && Math.abs(c - mid) <= rad) continue;
          if (qrMatrix.get(r, c)) {
            d += `M${c},${r}h1v1h-1z `;
          }
        }
      }
      return { size: sz, path: d };
    }

    const fb = generateFallbackQrModules(value);
    const sz = fb.size;
    const mid = Math.floor(sz / 2);
    const rad = 3;
    let d = '';
    for (let r = 0; r < sz; r++) {
      for (let c = 0; c < sz; c++) {
        if (Math.abs(r - mid) <= rad && Math.abs(c - mid) <= rad) continue;
        if (fb.get(r, c)) {
          d += `M${c},${r}h1v1h-1z `;
        }
      }
    }
    return { size: sz, path: d };
  }, [qrMatrix, value]);

  return (
    <div className={`relative bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center ${className}`}>
      <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-[#054FA6] rounded-tl pointer-events-none"></div>
      <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-[#054FA6] rounded-tr pointer-events-none"></div>
      <div className="absolute bottom-2 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-[#054FA6] rounded-bl pointer-events-none"></div>
      <div className="absolute bottom-2 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-[#054FA6] rounded-br pointer-events-none"></div>

      <div className="relative w-40 h-40 sm:w-44 sm:h-44 flex items-center justify-center bg-white p-1">
        {qrData && (
          <svg viewBox={`0 0 ${qrData.size} ${qrData.size}`} className="w-full h-full" shapeRendering="crispEdges">
            <rect width={qrData.size} height={qrData.size} fill={lightColor} />
            <path fill={darkColor} d={qrData.path} />
          </svg>
        )}

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="p-1 rounded-xl bg-white shadow-md border border-slate-200">
            <div className="w-8 h-8 rounded-lg bg-[#003B73] flex items-center justify-center p-1 text-white shadow-inner">
              <PochtaEmblem className="w-5 h-5" bg="#003B73" fg="#FFFFFF" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 text-center select-none pointer-events-none">
        <span className="text-[11px] font-medium text-slate-500 flex items-center justify-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5 text-[#054FA6]" />
          <span>Отсканируйте камерой для контроля</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Конфигурация отделения
 */
const BRANCH_CONFIG = {
  id: '390000',
  name: 'ОПС 390000 • Главпочтамт',
  city: 'г. Рязань, ул. Ленина, д. 20',
  closeTimeStr: '20:00',
  closeHour: 20,
  closeMinute: 0,
  alternativeBranch: {
    id: '390005',
    name: 'ОПС 390005 • ул. Гагарина, 14',
    etaMinutes: 11,
    travelMinutes: 8,
    load: 'Низкая (1 окно свободно)'
  }
};

/**
 * Реестр услуг
 */
export const SERVICES = [
  {
    id: '22222222-2222-2222-2222-222222222222',
    title: 'Получение писем и посылок',
    subtitle: 'По паспорту, SMS-коду или ПЭП (без оплаты)',
    avgMinutes: 3.5,
    windows: [2, 3],
    prefix: 'А',
    category: 'parcels',
    badgeColor: 'bg-blue-50 text-[#054FA6] border-blue-200'
  },
  {
    id: '33333333-2222-2222-2222-222222222222',
    title: 'Отправка писем и посылок',
    subtitle: 'Посылки, EMS, 1 класс, заказные письма, упаковка',
    avgMinutes: 5.5,
    windows: [1, 3],
    prefix: 'О',
    category: 'mail',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    title: 'Финансовые операции и касса',
    subtitle: 'Коммунальные платежи, денежные переводы, пенсии',
    avgMinutes: 5.0,
    windows: [1],
    prefix: 'П',
    category: 'cash',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  {
    id: '44444444-2222-2222-2222-222222222222',
    title: 'Знаки почтовой оплаты и товары',
    subtitle: 'Марки, открытки, периодика, конверты',
    avgMinutes: 2.0,
    windows: [1, 2, 3],
    prefix: 'Т',
    category: 'retail',
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200'
  }
];

export interface Ticket {
  id: string;
  number: string;
  serviceId: string;
  source: 'QR' | 'APPOINTMENT' | 'LIVE';
  appointmentTime?: string;
  createdAt: number;
  status: 'WAITING' | 'CALLED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
  clientEmail?: string;
  notifiedTriggers?: string[];
  windowId?: number | null;
  calledAt?: number;
  waitMinutes?: number;
  score?: number;
  isStarved?: boolean;
  appointmentStatus?: 'UPCOMING' | 'DUE_WINDOW' | 'LATE_DECAY' | 'LATE_EXTENDED' | null;
  isDepartmentDelayed?: boolean;
}

export interface PostalWindow {
  id: number;
  windowUuid?: string;
  name: string;
  operator: string;
  status: 'ACTIVE' | 'CLOSED' | 'OPEN';
  currentTicketId: string | null;
  servedCount: number;
  services: string[];
}

const LOCAL_STORAGE_KEY = 'pochta_suo_3_state_v2';

export default function PochtaDemo({ currentPath = '/demo', navigate }: { currentPath?: string, navigate?: (to: string, e?: any) => void }) {
  // Навигационные вкладки
  let activeTab = 'hub';
  if (currentPath.startsWith('/demo/client')) {
    // В зависимости от того, есть ли у клиента талон, показываем разные экраны
    activeTab = 'client-booking'; // по умолчанию, ниже мы переопределим если нужно
  } else if (currentPath === '/demo/operator') {
    activeTab = 'operator';
  } else if (currentPath === '/demo/admin') {
    activeTab = 'admin';
  } else if (currentPath === '/demo/tv') {
    activeTab = 'tv';
  } else if (currentPath === '/demo/terminal') {
    activeTab = 'kiosk';
  }

  const setActiveTab = (tab: string) => {
    if (!navigate) return;
    if (tab === 'client-ticket' || tab === 'client-booking') navigate('/demo/client');
    else if (tab === 'operator') navigate('/demo/operator');
    else if (tab === 'admin') navigate('/demo/admin');
    else if (tab === 'tv') navigate('/demo/tv');
    else if (tab === 'kiosk') navigate('/demo/terminal');
    else if (tab === 'hub') navigate('/demo');
  };

  // Аудио и голосовой диктор (Voice Engine)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isSoundEnabled());
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => isSoundEnabled());
  const [speechRate, setSpeechRate] = useState<number>(0.88);
  const [autoAnnounceCalls, setAutoAnnounceCalls] = useState<boolean>(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>('');
  const [isAudioSettingsModalOpen, setIsAudioSettingsModalOpen] = useState<boolean>(false);
  const [currentAnnouncement, setCurrentAnnouncement] = useState<{
    active: boolean;
    isSpeaking: boolean;
    ticketNumber: string;
    windowId: number | string;
    phrase: string;
    displayText: string;
  } | null>(null);

  // Режим доступности и эмуляция сети
  const [isAccessibilityMode, setIsAccessibilityMode] = useState<boolean>(false);
  const [isOfflineSimulated, setIsOfflineSimulated] = useState<boolean>(false);
  const [adminSubTab, setAdminSubTab] = useState<'overview' | 'policy' | 'anomalies' | 'audit' | 'users'>('overview');
  const [isFullscreenTv, setIsFullscreenTv] = useState<boolean>(false);

  const [tickets, setTickets] = useState<Ticket[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.tickets) && parsed.tickets.length > 0) return parsed.tickets;
      }
    } catch {}
    return [];
  });

  const [windows, setWindows] = useState<PostalWindow[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.windows) && parsed.windows.length > 0) return parsed.windows;
      }
    } catch {}
    return [];
  });

  const [myTicketId, setMyTicketId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.myTicketId) return parsed.myTicketId;
      }
    } catch {}
    return null;
  });

  const { overview } = useDemoIntegration(setTickets, setWindows);

    const [policyConfig, setPolicyConfig] = useState({
    weightAppointment: 1.5,
    weightQr: 1.0,
    weightLive: 1.0,
    waitMinutesFactor: 0.15,
    starvationThresholdMinutes: 15,
    appointmentDecayMinutes: 10
  });

  // Состояние формы бронирования
  const [bookingMode, setBookingMode] = useState<'qr' | 'appointment'>('qr');
  const [selectedServiceId, setSelectedServiceId] = useState('22222222-2222-2222-2222-222222222222');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('18:00');
  const [clientEmail, setClientEmail] = useState('');
  const [emailCodeInput, setEmailCodeInput] = useState('');
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [mockSentCode, setMockSentCode] = useState<string | null>(null);

  // Рабочее место оператора: выбор окна (1, 2, 3 или 4)
  const [operatorWindowId, setOperatorWindowId] = useState<number>(3);
  const [operatorElapsedSeconds, setOperatorElapsedSeconds] = useState(145);

  // Модальные окна и тосты
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isLiveQueueModalOpen, setIsLiveQueueModalOpen] = useState(false);
  const [isRedirectModalOpen, setIsRedirectModalOpen] = useState(false);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
  const [isCloseWindowModalOpen, setIsCloseWindowModalOpen] = useState(false);
  const [isKioskSlipModalOpen, setIsKioskSlipModalOpen] = useState(false);
  const [kioskCreatedTicket, setKioskCreatedTicket] = useState<Ticket | null>(null);

  // Журнал аудита талонов (Audit Trail)
  const [auditEvents, setAuditEvents] = useState([
    { id: 'a1', time: '17:35:10', type: 'COMPLETED', text: 'Талон А-039 успешно обслужен в Окне № 3' },
    { id: 'a2', time: '17:39:40', type: 'NO_SHOW', text: 'Талон В-012 не явился по вызову к Окну № 2 (статус NO_SHOW)' },
    { id: 'a3', time: '17:42:00', type: 'STARVATION_ESCALATION', text: 'Талон Ж-003 ожидает 17 мин -> повышен приоритет (Starvation Guard)' }
  ]);

  // Системное время отделения
  const [currentTime, setCurrentTime] = useState(new Date('2026-09-17T17:45:00+03:00'));

  // Аутентификация
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login'|'register'>('login');
  
  useEffect(() => {
    getMe().then(user => {
      setCurrentUser(user);
    }).catch(() => {
      setCurrentUser(null);
    }).finally(() => {
      setAuthLoading(false);
    });
  }, []);

  // Ролевая модель доступа (ТЗ: вход обязателен для всех, меню зависит от роли)
  const userRole = currentUser?.role ?? null;
  const isOperatorRole = userRole === 'employee' || userRole === 'opc_chief';
  const isAdminRole = userRole === 'opc_chief';
  const isClient = userRole === 'client' || (userRole !== null && !isOperatorRole && !isAdminRole);

  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const loadAdminUsers = useCallback(async () => {
    if (currentUser?.role === 'opc_chief') {
      try {
        const users = await listUsers();
        setAdminUsers(users.items);
      } catch (err) {
        console.error('Failed to load users', err);
      }
    }
  }, [currentUser]);

  useEffect(() => {
    if (activeTab === 'admin') {
      loadAdminUsers();
    }
  }, [activeTab, loadAdminUsers]);

  // Синхронизация состояния с LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
        tickets,
        windows,
        myTicketId,
        policyConfig
      }));
    } catch {}
  }, [tickets, windows, myTicketId, policyConfig]);

  // Умное переключение клиента между booking и ticket
  if (activeTab === 'client-booking' && myTicketId) {
    activeTab = 'client-ticket';
  } else if (activeTab === 'client-ticket' && !myTicketId) {
    activeTab = 'client-booking';
  }

  // Загрузка голосов синтезатора речи
  useEffect(() => {
    const updateVoices = () => {
      const ruVoices = getRussianSpeechVoices();
      setAvailableVoices(ruVoices);
      if (ruVoices.length > 0 && !selectedVoiceName) {
        setSelectedVoiceName(ruVoices[0].name);
      }
    };

    updateVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, [selectedVoiceName]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(prev => new Date(prev.getTime() + 1000));
      setOperatorElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const logAudit = useCallback((type: string, text: string) => {
    const timeStr = currentTime.toTimeString().split(' ')[0];
    setAuditEvents(prev => [{ id: 'evt-' + Date.now() + Math.random(), time: timeStr, type, text }, ...prev]);
  }, [currentTime]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }, []);

  /**
   * Комплексное воспроизведение вызова клиента диктором
   */
  const handleAnnounce = useCallback((ticketNumber: string, windowId: number | string) => {
    const phraseData = formatAnnouncementPhrase(ticketNumber, windowId);

    // Обновляем UI сразу (показываем следующее объявление в очереди)
    setCurrentAnnouncement({
      active: true,
      isSpeaking: false,
      ticketNumber: phraseData.ticketNumber,
      windowId: phraseData.windowId,
      phrase: phraseData.phrase,
      displayText: phraseData.displayText
    });

    logAudit('VOICE_ANNOUNCEMENT', `Озвучено в зале: «${phraseData.displayText}»`);

    // Ставим в FIFO-очередь: следующее объявление начнётся только после завершения текущего
    enqueueAnnouncement(() =>
      announceTicketCall(ticketNumber, windowId, {
        soundEnabled,
        voiceEnabled,
        speechRate,
        selectedVoiceName,
        onStart: () => {
          setCurrentAnnouncement(prev => prev ? { ...prev, isSpeaking: true } : null);
        },
        onEnd: () => {
          setCurrentAnnouncement(prev => prev ? { ...prev, isSpeaking: false } : null);
          setTimeout(() => {
            setCurrentAnnouncement(null);
          }, 3000);
        }
      })
    );
  }, [soundEnabled, voiceEnabled, speechRate, selectedVoiceName, logAudit]);

  /**
   * Интеллектуальный Queue Engine с учетом SLA, опозданий и Starvation Guard
   */
  const queueScoring = useMemo(() => {
    const currentHour = Number(currentTime.toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hourCycle: 'h23' }));
    const currentMin = currentTime.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMin;

    const waitingTickets = tickets.filter(t => t.status === 'WAITING' || (t.status as any) === 'SCHEDULED');
    const activeWindows = windows.filter(w => w.status === 'ACTIVE');

    const scored = waitingTickets.map(ticket => {
      const waitMinutes = Math.max(1, Math.round((currentTime.getTime() - ticket.createdAt) / 60000));
      let score = 0;
      let isStarved = false;
      let appointmentStatus: Ticket['appointmentStatus'] = null;
      let isDepartmentDelayed = false;

      if (ticket.source === 'APPOINTMENT' && ticket.appointmentTime) {
        const [aptH, aptM] = ticket.appointmentTime.split(':').map(Number);
        const aptTotalMinutes = aptH * 60 + aptM;
        const diff = currentTotalMinutes - aptTotalMinutes;

        const suitableBusy = activeWindows.filter(w => w.services.includes(ticket.serviceId) && w.currentTicketId !== null);
        const suitableTotal = activeWindows.filter(w => w.services.includes(ticket.serviceId));
        if (diff > 0 && suitableBusy.length === suitableTotal.length && suitableTotal.length > 0) {
          isDepartmentDelayed = true;
        }

        if (diff < 0) {
          score = policyConfig.weightAppointment + (waitMinutes * policyConfig.waitMinutesFactor * 0.4);
          appointmentStatus = 'UPCOMING';
        } else if (diff <= policyConfig.appointmentDecayMinutes) {
          score = policyConfig.weightAppointment + 4.5 + (waitMinutes * policyConfig.waitMinutesFactor);
          appointmentStatus = 'DUE_WINDOW';
        } else if (diff <= 20) {
          const decay = (diff - policyConfig.appointmentDecayMinutes) * 0.25;
          score = Math.max(1.5, policyConfig.weightAppointment + 4.5 - decay + (waitMinutes * policyConfig.waitMinutesFactor));
          appointmentStatus = 'LATE_DECAY';
        } else {
          score = policyConfig.weightAppointment + 0.8 + (waitMinutes * policyConfig.waitMinutesFactor);
          appointmentStatus = 'LATE_EXTENDED';
        }
      } else if (ticket.source === 'LIVE') {
        score = policyConfig.weightLive + (waitMinutes * policyConfig.waitMinutesFactor);
      } else {
        score = policyConfig.weightQr + (waitMinutes * policyConfig.waitMinutesFactor);
      }

      if (waitMinutes >= policyConfig.starvationThresholdMinutes) {
        score += 10.0;
        isStarved = true;
      }

      return {
        ...ticket,
        waitMinutes,
        score: Number(score.toFixed(2)),
        isStarved,
        appointmentStatus,
        isDepartmentDelayed
      };
    });

    scored.sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
    return scored;
  }, [tickets, currentTime, policyConfig, windows]);

  /**
   * Расчет метрик ожидания (ETA, позиция в очереди)
   */
  const calculatedQueueMetrics = useMemo(() => {
    const activeWindows = windows.filter(w => w.status === 'ACTIVE');
    const metricsMap: Record<string, {
      position: number;
      overallPosition: number;
      etaMinutes: number;
      suitableWindowCount: number;
      willFitBeforeClosing: boolean;
      isHighRisk: boolean;
      estFinishTimeStr: string;
      branchLoadPercent: number;
    }> = {};
    const serviceGroups: Record<string, number> = {};

    const branchLoadPercent = Math.min(100, Math.round((queueScoring.length / Math.max(1, activeWindows.length * 3)) * 100));

    queueScoring.forEach((ticket, idx) => {
      const srv = SERVICES.find(s => s.id === ticket.serviceId);
      const avgDuration = srv ? srv.avgMinutes : 4.0;
      const suitableWindows = activeWindows.filter(w => w.services.includes(ticket.serviceId));
      const capacity = Math.max(1, suitableWindows.length);

      const countAheadInService = serviceGroups[ticket.serviceId] || 0;
      serviceGroups[ticket.serviceId] = countAheadInService + 1;

      const positionInService = countAheadInService + 1;
      const calculatedEta = Math.max(2, Math.round((countAheadInService * avgDuration) / capacity));

      const finishDate = new Date(currentTime.getTime() + (calculatedEta + avgDuration) * 60000);
      const finishHour = Number(finishDate.toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hourCycle: 'h23' }));
      const finishMin = finishDate.getMinutes();
      const finishTimeStr = `${finishHour.toString().padStart(2, '0')}:${finishMin.toString().padStart(2, '0')}`;

      const closingMinutes = BRANCH_CONFIG.closeHour * 60 + BRANCH_CONFIG.closeMinute;
      const estFinishMinutes = finishHour * 60 + finishMin;
      const willFitBeforeClosing = estFinishMinutes <= closingMinutes;
      const isHighRisk = (closingMinutes - estFinishMinutes) < 25;

      metricsMap[ticket.id] = {
        position: positionInService,
        overallPosition: idx + 1,
        etaMinutes: calculatedEta,
        suitableWindowCount: capacity,
        willFitBeforeClosing,
        isHighRisk,
        estFinishTimeStr: finishTimeStr,
        branchLoadPercent
      };
    });

    return metricsMap;
  }, [queueScoring, windows, currentTime]);

  const activeClientTicket = useMemo(() => {
    return tickets.find(t => t.id === myTicketId) || tickets[0] || null;
  }, [tickets, myTicketId]);

  const activeClientMetrics = useMemo(() => {
    if (!activeClientTicket) return null;
    return calculatedQueueMetrics[activeClientTicket.id] || {
      position: 1,
      overallPosition: 1,
      etaMinutes: 4,
      suitableWindowCount: 2,
      willFitBeforeClosing: true,
      isHighRisk: false,
      estFinishTimeStr: '18:10',
      branchLoadPercent: 65
    };
  }, [activeClientTicket, calculatedQueueMetrics]);

  // Уведомления о приближении очереди отключены по просьбе пользователя

  // Текущий билет для выбранного окна оператора.
  // Пока список окон ещё не пришёл с бэкенда (или localStorage пуст),
  // отдаём безопасную заглушку: иначе operatorSelectedWindow === undefined
  // и экран оператора падает на первом рендере (белая страница).
  const operatorSelectedWindow = useMemo<PostalWindow>(() => {
    return windows.find(w => w.id === operatorWindowId) || windows[0] || {
      id: operatorWindowId,
      name: `Окно ${operatorWindowId}`,
      operator: 'Оператор',
      status: 'ACTIVE',
      currentTicketId: null,
      servedCount: 0,
      services: [],
    };
  }, [windows, operatorWindowId]);

  const operatorCurrentTicket = useMemo(() => {
    const win = operatorSelectedWindow;
    if (!win || !win.currentTicketId) return null;
    return tickets.find(t => t.number === win.currentTicketId || t.id === win.currentTicketId) || {
      id: 'mock-current',
      number: win.currentTicketId,
      serviceId: '22222222-2222-2222-2222-222222222222',
      source: 'QR' as const,
      createdAt: Date.now() - 3 * 60 * 1000,
      status: 'CALLED' as const
    };
  }, [operatorSelectedWindow, tickets]);

  // Текущий вызов для произвольного окна (для живого ТВ-табло).
  const getWindowCurrentTicket = useCallback((winId: number | string) => {
    const win = windows.find(w => w.id === winId);
    if (!win || !win.currentTicketId) return null;
    return tickets.find(t => t.number === win.currentTicketId || t.id === win.currentTicketId) || null;
  }, [windows, tickets]);

  /**
   * Вызов следующего клиента окном оператора
   */
  const handleOperatorCallNext = useCallback(async () => {
    const opWindow = windows.find(w => w.id === operatorWindowId);
    if (!opWindow) {
      showToast(`Окно № ${operatorWindowId} не найдено`);
      return;
    }
    if (!opWindow.windowUuid) {
      showToast(`Окно № ${operatorWindowId} синхронизируется с сервером. Пожалуйста, подождите секунду или войдите в систему.`);
      return;
    }

    if (opWindow.status !== 'ACTIVE' && opWindow.status !== 'OPEN') {
      showToast(`Окно № ${operatorWindowId} закрыто. Откройте смену для вызова клиентов`);
      return;
    }

    try {
      const candidate = await callNext(opWindow.windowUuid);
      
      const mapped = mapBackendTicketToDemo(candidate);
      
      setTickets(prev => {
        const filtered = prev.filter(t => t.id !== mapped.id);
        return [mapped, ...filtered];
      });

      setWindows(prev => prev.map(w => w.id === operatorWindowId ? { ...w, currentTicketId: mapped.number } : w));
      setOperatorElapsedSeconds(0);

      showToast(`Окно № ${operatorWindowId}: Вызван талон ${mapped.number}`);
      logAudit('CALL_NEXT', `Окно № ${operatorWindowId} вызвало талон ${mapped.number} (${mapped.source})`);

      if (autoAnnounceCalls || voiceEnabled) {
        handleAnnounce(mapped.number, operatorWindowId);
      } else if (soundEnabled) {
        playPostalChime();
      }
    } catch (e: any) {
      showToast(`Ошибка: ${e.message}`);
    }
  }, [windows, operatorWindowId, showToast, logAudit, autoAnnounceCalls, voiceEnabled, soundEnabled, handleAnnounce]);

  const handleOperatorFinish = useCallback(async () => {
    if (!operatorCurrentTicket) return;

    try {
      if (operatorCurrentTicket.status === 'CALLED') {
         await startService(operatorCurrentTicket.id);
      }
      const finishedTicket = await completeService(operatorCurrentTicket.id);
      
      const finishedNum = finishedTicket.publicNumber;
      
      setTickets(prev => prev.map(t => t.number === finishedNum ? { ...t, status: 'COMPLETED' } : t));
      setWindows(prev => prev.map(w => w.id === operatorWindowId ? { ...w, currentTicketId: null, servedCount: w.servedCount + 1 } : w));

      showToast(`Обслуживание талона ${finishedNum} завершено`);
      logAudit('COMPLETED', `Талон ${finishedNum} успешно обслужен в Окне № ${operatorWindowId}`);
    } catch (e: any) {
      showToast(`Ошибка: ${e.message}`);
    }
  }, [operatorCurrentTicket, operatorWindowId, showToast, logAudit]);

  const handleOperatorNoShow = useCallback(async () => {
    if (!operatorCurrentTicket) return;

    try {
      const ticket = await markNoShow(operatorCurrentTicket.id);
      
      const targetNum = ticket.publicNumber;
      
      setTickets(prev => prev.map(t => t.number === targetNum ? { ...t, status: 'NO_SHOW' } : t));
      setWindows(prev => prev.map(w => w.id === operatorWindowId ? { ...w, currentTicketId: null } : w));

      showToast(`Талон ${targetNum} зафиксирован: НЕ ЯВИЛСЯ (NO_SHOW)`);
      logAudit('NO_SHOW', `Клиент талона ${targetNum} не подошел к Окну № ${operatorWindowId}`);
    } catch (e: any) {
      showToast(`Ошибка: ${e.message}`);
    }
  }, [operatorCurrentTicket, operatorWindowId, showToast, logAudit]);

  const handleOperatorReturnToQueue = useCallback(() => {
    if (!operatorCurrentTicket) return;

    const targetNum = operatorCurrentTicket.number;
    setTickets(prev => prev.map(t => t.number === targetNum ? { ...t, status: 'WAITING', windowId: null } : t));
    setWindows(prev => prev.map(w => w.id === operatorWindowId ? { ...w, currentTicketId: null } : w));

    showToast(`Талон ${targetNum} возвращен в очередь с сохранением приоритета`);
    logAudit('RETURNED', `Талон ${targetNum} возвращен оператором в пул ожидания`);
  }, [operatorCurrentTicket, operatorWindowId, showToast, logAudit]);

  const handleToggleWindowShift = async (targetWindowId: number) => {
    // Окно в UI нумеруется локально; windowUuid хранит реальный UUID из backend.
    const w = windows.find(x => x.id === targetWindowId);
    if (!w || !w.windowUuid) return;
    const nextStatus: 'ACTIVE' | 'CLOSED' = w.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
    const apiStatus: 'OPEN' | 'CLOSED' | 'CLOSING' = nextStatus === 'ACTIVE' ? 'OPEN' : 'CLOSED';
    try {
      // Persist via API: иначе overview-опрос на 3 сек. откатывает смену статуса.
      await changeWindowStatus(w.windowUuid, apiStatus);
      setWindows(prev => prev.map(x => x.id === targetWindowId ? { ...x, status: nextStatus } : x));
      logAudit('WINDOW_STATUS_CHANGE', `${w.name}: статус изменён на ${nextStatus === 'ACTIVE' ? 'В РАБОТЕ' : 'ЗАКРЫТА'}`);
      showToast(`${w.name}: смена ${nextStatus === 'ACTIVE' ? 'открыта' : 'закрыта'}`);
    } catch (e: any) {
      showToast(`Ошибка смены статуса: ${e?.message || 'сервер недоступен'}`);
    }
  };

  const handleToggleWindowService = async (targetWindowId: number, serviceId: string) => {
    const w = windows.find(x => x.id === targetWindowId);
    if (!w || !w.windowUuid) return;
    const hasService = w.services.includes(serviceId);
    let newServices: string[];
    if (hasService) {
      newServices = w.services.filter(s => s !== serviceId);
      if (newServices.length === 0) {
        showToast('У окна должна быть доступна хотя бы одна услуга');
        return w;
      }
    } else {
      newServices = [...w.services, serviceId];
    }
    try {
      // Persist capability set: иначе overview-опрос откатывает переключение услуг.
      await updateWindowServices(w.windowUuid, newServices);
      setWindows(prev => prev.map(x => x.id === targetWindowId ? { ...x, services: newServices } : x));
      logAudit('WINDOW_SERVICES_CHANGE', `${w.name}: обновлён список услуг`);
      showToast(`${w.name}: список услуг сохранён`);
    } catch (e: any) {
      const st = e?.status;
      if (st === 409 || e?.code === 'INVALID_TICKET_STATE') {
        showToast('Услугу нельзя отключить: есть талоны, обслуженные в окне');
      } else if (st === 404) {
        showToast('Окно не найдено');
      } else {
        showToast(`Ошибка сохранения услуг: ${e?.message || 'сервер недоступен'}`);
      }
    }
    return undefined;
  };

  /**
   * Горячие клавиши оператора: [Пробел] - вызов след., [Enter] - завершение
   */
  useEffect(() => {
    if (activeTab !== 'operator') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleOperatorCallNext();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        handleOperatorFinish();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, handleOperatorCallNext, handleOperatorFinish]);

  const handleAddLiveQueue = async (serviceId: string) => {
    setIsLiveQueueModalOpen(false);
    try {
      const ticket = await createLiveTicket(
        DEMO_BRANCH_ID,
        serviceId,
        crypto.randomUUID()
      );
      
      const mapped = mapBackendTicketToDemo(ticket);
      
      setTickets(prev => [mapped, ...prev]);
      showToast(`Выдан талон живой очереди ${mapped.number}`);
      logAudit('LIVE_TICKET_ISSUED', `Оператор Окна № ${operatorWindowId} выдал талон ${mapped.number} (услуга: ${SERVICES.find(s => s.id === serviceId)?.title})`);
    } catch (e: any) {
      showToast(`Ошибка: ${e.message}`);
    }
  };

  const handleRedirectTicket = (targetWindowId: number) => {
    setIsRedirectModalOpen(false);
    if (!operatorCurrentTicket) return;

    const targetWin = windows.find(w => w.id === targetWindowId);
    showToast(`Талон ${operatorCurrentTicket.number} перенаправлен в ${targetWin ? targetWin.name : `Окно № ${targetWindowId}`}`);
    logAudit('REDIRECT', `Талон ${operatorCurrentTicket.number} перенаправлен из Окна № ${operatorWindowId} в Окно № ${targetWindowId}`);

    setWindows(prev => prev.map(w => w.id === operatorWindowId ? { ...w, currentTicketId: null } : w));
  };

  const handleRequestVerificationCode = () => {
    if (!clientEmail.includes('@')) {
      showToast('Введите корректный email адрес');
      return;
    }
    const code = '7341';
    setMockSentCode(code);
    showToast(`Код подтверждения: ${code} (отправлен на ${clientEmail})`);
    logAudit('EMAIL_VERIFY_REQUEST', `Запрос кода верификации: ${clientEmail}`);
  };

  const handleConfirmVerificationCode = () => {
    if (emailCodeInput === '7341' || emailCodeInput === mockSentCode) {
      setIsEmailVerified(true);
      showToast('Email верифицирован! Сессия привязана');
    } else {
      showToast('Неверный код. Введите 7341');
    }
  };

  const DEMO_BRANCH_ID = '11111111-1111-1111-1111-111111111111';

  const handleCreateClientTicket = async () => {
    try {
      if (bookingMode === 'appointment') {
        const tomorrow = toMoscowDatetimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)).slice(0, 10);
        
        const created = await createAppointment(
          DEMO_BRANCH_ID,
          selectedServiceId,
          parseMoscowDatetimeLocal(`${tomorrow}T${selectedTimeSlot}`),
          crypto.randomUUID()
        );
        
        const mapped = mapBackendTicketToDemo(created.ticket);
        setTickets(prev => [mapped, ...prev]);
        setMyTicketId(mapped.id);
        setActiveTab('client-ticket');
        showToast(`Талон ${mapped.number} на ${selectedTimeSlot} успешно сформирован!`);
        logAudit('CLIENT_TICKET_CREATED', `Создан талон ${mapped.number} (${mapped.source})`);
      } else {
        const created = await createQrTicket(
          DEMO_BRANCH_ID,
          selectedServiceId,
          crypto.randomUUID()
        );
        
        const mapped = mapBackendTicketToDemo(created);
        setTickets(prev => [mapped, ...prev]);
        setMyTicketId(mapped.id);
        setActiveTab('client-ticket');
        showToast(`Талон ${mapped.number} успешно сформирован!`);
        logAudit('CLIENT_TICKET_CREATED', `Создан талон ${mapped.number} (${mapped.source})`);
      }

      if (soundEnabled) {
        playPostalChime(0.2);
      }
    } catch (e: any) {
      showToast(`Ошибка: ${e.message}`);
    }
  };

  /**
   * Оформление талона в терминале самообслуживания (Киоск)
   */
  const handleKioskSelectService = async (serviceId: string) => {
    try {
      const created = await createQrTicket(
        DEMO_BRANCH_ID,
        serviceId,
        crypto.randomUUID()
      );
      
      const mapped = mapBackendTicketToDemo(created);
      setTickets(prev => [mapped, ...prev]);
      setMyTicketId(mapped.id);
      setKioskCreatedTicket(mapped);
      setIsKioskSlipModalOpen(true);
      
      const srv = SERVICES.find(s => s.id === serviceId) || SERVICES[0];
      logAudit('KIOSK_TICKET_ISSUED', `Терминал самообслуживания выдал талон ${mapped.number} (${srv.title})`);

      if (voiceEnabled) {
        playPostalChime(0.25).then(() => {
          if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(`Ваш талон сформирован. Пожалуйста, сохраните номер ${mapped.number} и ожидайте вызова на табло.`);
            u.lang = 'ru-RU';
            u.rate = 0.95;
            window.speechSynthesis.speak(u);
          }
        });
      } else if (soundEnabled) {
        playPostalChime();
      }
    } catch (e: any) {
      showToast(`Ошибка терминала: ${e.message}`);
    }
  };

  const toggleTvFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreenTv(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreenTv(false)).catch(() => {});
    }
  };

  const downloadCalendarEvent = (ticket: Ticket) => {
    const timeSlot = ticket.appointmentTime || '18:00';
    const [h, m] = timeSlot.split(':');
    const startIso = `20260917T${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
    const endIso = `20260917T${h.padStart(2, '0')}${(Number(m) + 15).toString().padStart(2, '0')}00`;

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Почта России//Электронная очередь СУО 3.0//RU',
      'BEGIN:VEVENT',
      `SUMMARY:Почта России: Талон ${ticket.number} (${timeSlot})`,
      `DESCRIPTION:Запись в ${BRANCH_CONFIG.name}. Услуга: ${SERVICES.find(s => s.id === ticket.serviceId)?.title}. Номер талона: ${ticket.number}. Прибудьте за 5 минут до начала.`,
      `LOCATION:${BRANCH_CONFIG.city}`,
      `DTSTART:${startIso}`,
      `DTEND:${endIso}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Pochta_${ticket.number}_appointment.ics`;
    link.click();
    showToast('Календарный файл (.ics) выгружен!');
  };

  const downloadTicketAsImage = (ticket: Ticket) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(32, 32, 576, 896);
    ctx.strokeStyle = '#D2D8E2';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(32, 32, 576, 896);

    ctx.fillStyle = '#003B73';
    ctx.fillRect(32, 32, 576, 210);

    ctx.fillStyle = '#D92534';
    ctx.fillRect(32, 242, 576, 5);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('ПОЧТА РОССИИ', 64, 86);

    ctx.fillStyle = '#86BBFF';
    ctx.font = '600 13px monospace';
    ctx.fillText(BRANCH_CONFIG.name.toUpperCase(), 64, 114);
    ctx.fillText(BRANCH_CONFIG.city, 64, 134);

    // Штемпель в синей шапке билета (лазурный #86BBFF, точно как в UI веб-талона)
    ctx.save();
    ctx.translate(535, 105);
    ctx.rotate(0.2);
    ctx.strokeStyle = '#86BBFF';
    ctx.fillStyle = '#86BBFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.92;

    ctx.lineWidth = 1.6;
    ctx.setLineDash([3.5, 2.5]);
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-44, 0); ctx.lineTo(-26, 0);
    ctx.moveTo(26, 0); ctx.lineTo(44, 0);
    ctx.moveTo(0, -44); ctx.lineTo(0, -26);
    ctx.moveTo(0, 26); ctx.lineTo(0, 44);
    ctx.stroke();

    const drawHeaderFittedText = (
      text: string,
      y: number,
      baseSize: number,
      maxR: number,
      isMono: boolean = false
    ) => {
      const availableChord = 2 * Math.sqrt(Math.max(1, maxR * maxR - y * y)) - 12;
      let sz = baseSize;
      const family = isMono ? 'monospace' : '"Golos Text", -apple-system, sans-serif';
      ctx.font = `bold ${sz}px ${family}`;
      let measured = ctx.measureText(text).width;
      while (measured > availableChord && sz > 4) {
        sz -= 0.4;
        ctx.font = `bold ${sz}px ${family}`;
        measured = ctx.measureText(text).width;
      }
      ctx.fillText(text, 0, y);
    };

    drawHeaderFittedText('ПОЧТА РОССИИ', -16, 7.5, 44);
    drawHeaderFittedText(currentTime.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' }), -2, 9, 26, true);
    drawHeaderFittedText(currentTime.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }), 10, 7.5, 26, true);
    drawHeaderFittedText(`${BRANCH_CONFIG.city} ${BRANCH_CONFIG.id}`, 18, 7, 44);

    ctx.restore();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 76px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ticket.number, canvas.width / 2, 210);

    const srv = SERVICES.find(s => s.id === ticket.serviceId);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 19px sans-serif';
    ctx.fillText(srv ? srv.title : 'Почтовые услуги', canvas.width / 2, 296);

    const qrPayload = `https://www.pochta.ru/q?ticket=${ticket.number}&ops=${BRANCH_CONFIG.id}`;
    let qrModules: { size: number; get: (r: number, c: number) => boolean } | null = null;
    try {
      if (typeof QRCode !== 'undefined' && QRCode.create) {
        const qr = QRCode.create(qrPayload, { errorCorrectionLevel: 'H' });
        qrModules = { size: qr.modules.size, get: (r: number, c: number) => Boolean(qr.modules.get(r, c)) };
      }
    } catch {}

    if (!qrModules) {
      qrModules = generateFallbackQrModules(qrPayload);
    }

    const qrBoxSize = 210;
    const qrStartX = canvas.width / 2 - qrBoxSize / 2;
    const qrStartY = 335;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(qrStartX - 10, qrStartY - 10, qrBoxSize + 20, qrBoxSize + 20);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(qrStartX - 10, qrStartY - 10, qrBoxSize + 20, qrBoxSize + 20);

    const modSz = qrBoxSize / qrModules.size;
    ctx.fillStyle = '#003B73';
    const midMod = Math.floor(qrModules.size / 2);
    const logoRadMod = 4;

    for (let r = 0; r < qrModules.size; r++) {
      for (let c = 0; c < qrModules.size; c++) {
        if (Math.abs(r - midMod) <= logoRadMod && Math.abs(c - midMod) <= logoRadMod) continue;
        if (qrModules.get(r, c)) {
          ctx.fillRect(qrStartX + c * modSz, qrStartY + r * modSz, modSz + 0.35, modSz + 0.35);
        }
      }
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(canvas.width / 2 - 22, qrStartY + qrBoxSize / 2 - 22, 44, 44);
    ctx.fillStyle = '#003B73';
    ctx.beginPath();
    ctx.roundRect(canvas.width / 2 - 18, qrStartY + qrBoxSize / 2 - 18, 36, 36, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ПР', canvas.width / 2, qrStartY + qrBoxSize / 2 + 5);

        // ОФИЦИАЛЬНЫЙ КАЛЕНДАРНЫЙ ШТЕМПЕЛЬ (ПЕЧАТЬ) ПОЧТЫ РОССИИ НА КАРТОЧКЕ
    // Текст математически строго вписывается в хорду кругов и никогда не выходит за края!
        ctx.save();
    ctx.translate(460, 595);
    ctx.rotate(0.2);

    const stampDate = currentTime.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' });
    const stampTime = currentTime.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
    const stampCity = `${BRANCH_CONFIG.city} ${BRANCH_CONFIG.id}`;

    // Концентрические кольца почтового штемпеля
    ctx.strokeStyle = '#054FA6';
    ctx.fillStyle = '#054FA6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Внешнее кольцо с пунктиром (r = 60)
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, 60, 0, Math.PI * 2);
    ctx.stroke();

    // Среднее сплошное кольцо (r = 54)
    ctx.setLineDash([]);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, 54, 0, Math.PI * 2);
    ctx.stroke();

    // Внутреннее кольцо (r = 30)
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.stroke();

    // Радиальные засечки (крестовина)
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-54, 0); ctx.lineTo(-30, 0);
    ctx.moveTo(30, 0); ctx.lineTo(54, 0);
    ctx.moveTo(0, -54); ctx.lineTo(0, -30);
    ctx.moveTo(0, 30); ctx.lineTo(0, 54);
    ctx.stroke();

    // Функция гарантированного вписывания текста в хорду окружности с запасом
    const drawFittedStampText = (
      text: string,
      y: number,
      baseSize: number,
      maxR: number,
      isMono: boolean = false
    ) => {
      // Доступная ширина хорды на высоте y за вычетом безопасного отступа 14px
      const availableChord = 2 * Math.sqrt(Math.max(1, maxR * maxR - y * y)) - 14;
      let sz = baseSize;
      const family = isMono ? 'monospace' : '"Golos Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.font = `bold ${sz}px ${family}`;
      let measured = ctx.measureText(text).width;
      while (measured > availableChord && sz > 4.5) {
        sz -= 0.4;
        ctx.font = `bold ${sz}px ${family}`;
        measured = ctx.measureText(text).width;
      }
      ctx.fillText(text, 0, y);
    };

    // Верхний текст: ПОЧТА РОССИИ (на высоте -18 хорда = 102px, текст ~65px -> огромный запас)
    drawFittedStampText('ПОЧТА РОССИИ', -18, 8.2, 54);

    // Центр штемпеля: дата и время гашения талона
    drawFittedStampText(stampDate, -3, 10, 30, true);
    drawFittedStampText(stampTime, 11, 8.2, 30, true);

    // Нижний текст: Город и индекс отделения (хорда = 99px)
    drawFittedStampText(stampCity, 20, 8, 54);

    ctx.restore();

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('Штриховой почтовый идентификатор (ШПИ):', canvas.width / 2, 690);
    ctx.font = 'bold 22px monospace';
    ctx.fillText('8009 2182 0491 02', canvas.width / 2, 725);

    ctx.fillStyle = '#475569';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Канал: ${ticket.source} • Режим: до ${BRANCH_CONFIG.closeTimeStr}`, canvas.width / 2, 810);
    ctx.fillText('Предъявите экран со штрих-кодом оператору окна', canvas.width / 2, 835);

    const link = document.createElement('a');
    link.download = `Pochta_Ticket_${ticket.number}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Талон сохранен в файл PNG!');
  };

  const handleShareTicket = (ticket: Ticket) => {
    const text = `Мой талон Почты России: ${ticket.number} в ${BRANCH_CONFIG.name}. Подробнее: https://www.pochta.ru/q?t=${ticket.number}`;
    if (navigator.share) {
      navigator.share({ title: 'Талон электронной очереди', text, url: window.location.href }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text);
      showToast('Ссылка на талон скопирована в буфер обмена!');
    }
  };

  // Список аномалий для начальника ОПС
  const anomaliesList = useMemo(() => {
    const list: Array<{
      id: string;
      type: string;
      badge: string;
      ticket: string;
      details: string;
      severity: string;
    }> = [];
    const starvedTickets = queueScoring.filter(t => t.isStarved);
    starvedTickets.forEach(t => {
      list.push({
        id: `starve-${t.id}`,
        type: 'STARVATION',
        badge: 'Превышение SLA (> 15 мин)',
        ticket: t.number,
        details: `Ожидает ${t.waitMinutes} мин. Приоритет повышен Starvation Guard (+10)`,
        severity: 'danger'
      });
    });

    const noShowTickets = tickets.filter(t => t.status === 'NO_SHOW');
    noShowTickets.forEach(t => {
      list.push({
        id: `noshow-${t.id}`,
        type: 'NO_SHOW',
        badge: 'Неявка клиента',
        ticket: t.number,
        details: `Клиент не подошел к окну после приглашения`,
        severity: 'warning'
      });
    });

    const lateTickets = queueScoring.filter(t => t.appointmentStatus === 'LATE_DECAY' || t.appointmentStatus === 'LATE_EXTENDED');
    lateTickets.forEach(t => {
      list.push({
        id: `late-${t.id}`,
        type: 'APPOINTMENT_LATE',
        badge: 'Опоздание на слот',
        ticket: t.number,
        details: `Слот был на ${t.appointmentTime}. Включено плавное снижение веса`,
        severity: 'info'
      });
    });

    // Добавляем аномалии с сервера (Admin Overview API)
    if (overview?.anomalies && Array.isArray(overview.anomalies)) {
      overview.anomalies.forEach((a: any) => {
        if (!list.some(existing => existing.ticket === a.publicNumber)) {
          list.push({
            id: `server-${a.id}`,
            type: a.type || 'ANOMALY',
            badge: a.type === 'NO_SHOW' ? 'Неявка клиента' : 'Превышение ожидания',
            ticket: a.publicNumber,
            details: a.description || `Зафиксировано отклонение по талону`,
            severity: a.type === 'NO_SHOW' ? 'warning' : 'danger'
          });
        }
      });
    }

    return list;
  }, [queueScoring, tickets, overview]);

    // AUTH GATE: вход/регистрация обязательны для всех пользователей.
  // Пока сессия не подтверждена — никакой интерфейс не рендерится.
    if (authLoading || !currentUser) {
    const submitGateAuth = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
      const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
      try {
        if (authMode === 'login') {
          await login(email, password);
        } else {
          await register(email, password);
          await login(email, password);
        }
        const user = await getMe();
        setCurrentUser(user);
        showToast(authMode === 'login' ? 'Вы успешно вошли в систему' : 'Регистрация успешна. Добро пожаловать!');
      } catch (err: any) {
        showToast(`Ошибка: ${err.message}`);
      }
    };

    return (
      <div className="min-h-screen flex flex-col font-sans bg-[#F8FAFC] text-[#0F172A]">
        {/* Тост об ошибке/успехе */}
        {toastMessage && (
          <div className="fixed top-5 right-5 z-50 bg-white text-slate-900 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border-2 border-[#003B73] animate-in fade-in slide-in-from-top-2 text-xs font-semibold">
            <Info className="w-4 h-4 text-[#054FA6] shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {authLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-3 text-slate-500 text-sm font-semibold">
              <RefreshCw className="w-5 h-5 animate-spin text-[#054FA6]" />
              <span>Проверка сессии…</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-md">
              {/* Бренд */}
              <div className="flex flex-col items-center mb-8 text-center">
                <PochtaEmblem className="w-16 h-16 mb-4 drop-shadow-md" bg="#003B73" fg="#FFFFFF" />
                <h1 className="text-2xl font-black text-[#0A2896] tracking-tight">Электронная очередь Почты России</h1>
                <p className="text-sm text-slate-500 mt-2">Для работы с системой войдите в учётную запись или зарегистрируйтесь</p>
              </div>

              <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-8">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-bold text-lg text-slate-800">
                    {authMode === 'login' ? 'Вход в систему' : 'Регистрация'}
                  </h2>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">СУО 3.0</span>
                </div>

                <form onSubmit={submitGateAuth} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
                    <input name="email" type="email" required className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent" placeholder="user@example.ru" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Пароль</label>
                    <input name="password" type="password" required minLength={6} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent" placeholder="Минимум 6 символов" />
                  </div>
                  <button type="submit" className="w-full py-3 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-xl font-bold transition-colors shadow-md">
                    {authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button type="button" onClick={() => setAuthMode(m => m === 'login' ? 'register' : 'login')} className="w-full py-2.5 border border-[#054FA6]/30 text-[#054FA6] hover:bg-blue-50 rounded-xl text-xs font-bold transition-colors">
                    {authMode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
                  </button>
                  {authMode === 'register' && (
                    <p className="text-[11px] text-slate-400 mt-3">
                      Регистрация создаёт учётную запись клиента. Права оператора/начальника выдаёт начальник ОПС.
                    </p>
                  )}
                </div>
              </div>

              <p className="text-center text-[11px] text-slate-400 mt-6 font-mono">
                Доступ к интерфейсу определяется ролью: клиент, оператор, начальник ОПС
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors ${
      isAccessibilityMode ? 'bg-[#030e1e] text-[#FFE600]' : 'bg-[#F8FAFC] text-[#0F172A]'
    }`}>

            {/* ПЛАВАЮЩИЙ ОСТРОВОК ГОЛОСОВОГО ВЫЗОВА (FLOATING VOICE DYNAMIC ISLAND)      */}
      {/* Расположен внизу по центру: не перекрывает навигацию, вкладки и окна!     */}
      {/* Контрастный глубокий фон #070D1B с изумрудной каймой (не сливается)       */}
            {currentAnnouncement && (
        <aside
          role="status"
          aria-live="assertive"
          aria-label="Голосовое оповещение в зале"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg bg-white/98 text-slate-900 px-4 sm:px-5 py-3.5 rounded-2xl shadow-[0_16px_45px_rgba(0,59,115,0.16)] border-2 border-[#054FA6] ring-4 ring-blue-500/10 flex items-center justify-between gap-3 sm:gap-4 animate-in fade-in slide-in-from-bottom-5 duration-300 pointer-events-auto backdrop-blur-md"
        >
          {/* Левая иконка со звуковой индикацией */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative w-11 h-11 rounded-xl bg-[#EBF3FC] border border-[#CDE1F9] flex items-center justify-center shrink-0 shadow-sm">
              <Volume2 className="w-5 h-5 text-[#054FA6]" />
              {currentAnnouncement.isSpeaking && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#054FA6]"></span>
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#00823C] bg-[#EBF7EE] border border-[#C6EBD0] px-2 py-0.5 rounded-md">
                  {currentAnnouncement.isSpeaking ? 'Озвучивание в зале ОПС' : 'Оповещение завершено'}
                </span>
                {currentAnnouncement.isSpeaking && (
                  <div className="flex items-end gap-1 h-3.5 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                    <span className="w-1 bg-[#054FA6] rounded-full animate-pulse h-2"></span>
                    <span className="w-1 bg-blue-500 rounded-full animate-pulse delay-100 h-3.5"></span>
                    <span className="w-1 bg-[#00823C] rounded-full animate-pulse delay-200 h-2.5"></span>
                    <span className="w-1 bg-[#054FA6] rounded-full animate-pulse delay-75 h-3"></span>
                  </div>
                )}
              </div>

              {/* Крупный, разборчивый текст вызова в корпоративном стиле */}
              <div className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center gap-2 flex-wrap">
                <span className="text-slate-500 font-medium">Талон</span>
                <span className="font-mono text-[#003B73] bg-[#EBF3FC] px-2 py-0.5 rounded-md border border-[#CDE1F9] font-black">
                  {currentAnnouncement.ticketNumber}
                </span>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0 inline" />
                <span className="text-slate-500 font-medium">Окно</span>
                <span className="font-mono text-white bg-[#003B73] px-2.5 py-0.5 rounded-md font-black shadow-sm">
                  № {currentAnnouncement.windowId}
                </span>
              </div>
            </div>
          </div>

          {/* Правые кнопки управления: Повтор и Закрыть */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              title="Повторить голосовое озвучивание"
              onClick={() => handleAnnounce(currentAnnouncement.ticketNumber, currentAnnouncement.windowId)}
              className="px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-[#EBF3FC] text-[#003B73] text-xs font-bold transition-all border border-slate-200 hover:border-blue-300 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#054FA6]" />
              <span className="hidden sm:inline">Повтор</span>
            </button>

            <button
              type="button"
              title="Закрыть уведомление"
              onClick={() => setCurrentAnnouncement(null)}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-all border border-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* Информационный тост */}
      {toastMessage && (
        <div className="fixed top-20 right-5 z-50 bg-white text-slate-900 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border-2 border-[#003B73] animate-in fade-in slide-in-from-top-2 text-xs font-semibold">
          <Info className="w-4 h-4 text-[#054FA6] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Офлайн баннер */}
      {isOfflineSimulated && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold text-center flex items-center justify-center gap-2 border-b border-amber-600 shadow-sm">
          <WifiOff className="w-4 h-4 text-slate-950" />
          <span>РЕЖИМ АВТОНОМНОЙ РАБОТЫ (ОФЛАЙН): Сервер недоступен. Очередь работает на локальном хранилище устройства. Сессия сохранена.</span>
        </div>
      )}

            {/* ФИРМЕННАЯ ШАПКА ПОЧТЫ РОССИИ                                              */}
            <header className="bg-[#003B73] text-white shadow-lg sticky top-0 z-40">
        
        {/* Верхняя статусная линия */}
        <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-3 border-b border-white/10">
          
          {/* Бренд-блок: вордмарк + эмблема */}
          <div 
            className="flex items-center gap-3 cursor-pointer select-none group"
            onClick={() => setActiveTab('client-ticket')}
          >
            <PochtaEmblem className="w-9 h-9 shrink-0 drop-shadow-md transition-transform group-hover:scale-105" bg="#003B73" fg="#FFFFFF" />

            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <PochtaWordmark className="h-4 sm:h-5 w-auto" color="#FFFFFF" />
              </div>
              <div className="text-[11px] text-blue-200 flex items-center gap-1.5 mt-0.5 font-medium">
                <span className="text-blue-200 font-mono">до {BRANCH_CONFIG.closeTimeStr}</span>
              </div>
            </div>
          </div>

          {/* Панель быстрых инструментов (Озвучка, Доступность, Офлайн, Сброс) */}
          <div className="flex items-center gap-2 text-xs font-mono">
            
            {/* Кнопка настроек звука и озвучки */}
            <button
              type="button"
              onClick={() => setIsAudioSettingsModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl border transition-all ${
                voiceEnabled
                  ? 'bg-white/15 border-white/30 text-white hover:bg-white/25'
                  : 'bg-black/20 border-white/15 text-blue-200 hover:bg-white/10'
              }`}
              title="Параметры голосового диктора и гонга"
            >
              {voiceEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-[#86BBFF]" />
              ) : soundEnabled ? (
                <Volume1 className="w-3.5 h-3.5 text-blue-200" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span className="font-bold">
                {voiceEnabled ? 'Диктор: ВКЛ' : soundEnabled ? 'Гонг: ВКЛ' : 'Звук: ВЫКЛ'}
              </span>
            </button>

            {/* Доступность для слабовидящих */}
            <button
              type="button"
              onClick={() => {
                setIsAccessibilityMode(prev => !prev);
                showToast(isAccessibilityMode ? 'Обычный режим отображения' : 'Включен режим высокой контрастности для слабовидящих');
              }}
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl border transition-all ${
                isAccessibilityMode
                  ? 'bg-[#FFE600] text-black border-black font-black'
                  : 'bg-black/25 border-white/15 text-blue-100 hover:bg-white/10'
              }`}
              title="Версия для слабовидящих пользователей "
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Доступность</span>
            </button>

            {/* Эмуляция офлайн/онлайн */}
            <button
              type="button"
              onClick={() => {
                const next = !isOfflineSimulated;
                setIsOfflineSimulated(next);
                logAudit(next ? 'OFFLINE_SIMULATION' : 'ONLINE_RESTORED', next ? 'Включена эмуляция потери связи с центральным сервером' : 'Связь восстановлена: сессия синхронизирована');
                showToast(next ? 'Офлайн режим: данные талона сохранены локально' : 'Связь восстановлена: очередь синхронизирована!');
              }}
              className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl border transition-all ${
                isOfflineSimulated
                  ? 'bg-amber-400 text-slate-900 border-amber-500 font-bold'
                  : 'bg-black/25 border-white/15 text-blue-100 hover:bg-white/10'
              }`}
              title="Эмуляция потери связи и восстановления сессии "
            >
              {isOfflineSimulated ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{isOfflineSimulated ? 'Офлайн' : 'Онлайн'}</span>
            </button>

            {/* Время отделения */}
            <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1 rounded-lg border border-white/15 text-white font-bold text-xs select-none">
              <Clock className="w-3.5 h-3.5 text-[#86BBFF] shrink-0" />
              <span className="tabular-nums leading-none translate-y-[1px]">{currentTime.toTimeString().split(' ')[0]}</span>
            </div>

            {/* Авторизация */}
            <div className="flex items-center gap-2 border-l border-white/20 pl-2 ml-1">
              {currentUser ? (
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    <span className="text-[11px] font-bold text-white">{currentUser.email.split('@')[0]}</span>
                    <span className="text-[9px] text-blue-200 font-mono uppercase">{currentUser.role}</span>
                  </div>
                  <button onClick={async () => { await logout(); setCurrentUser(null); }} className="p-1.5 hover:bg-white/20 rounded-lg text-blue-100 transition-colors" title="Выйти">
                    <UserX className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button onClick={() => { setAuthMode('login'); setIsAuthModalOpen(true); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#003B73] hover:bg-blue-50 rounded-lg text-xs font-bold transition-colors">
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Войти</span>
                </button>
              )}
            </div>

          </div>

        </div>

        {/* Навигация */}
        {activeTab !== 'hub' && (
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center">
            <button
              onClick={() => setActiveTab('hub')}
              className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm font-semibold"
            >
              ← Меню
            </button>
          </div>
        )}

        {/* Фирменная тонкая красная линия Почты России */}
        <div className="h-[2px] w-full bg-[#D92534]"></div>
      </header>

            {/* ОСНОВНОЕ ТЕЛО СТРАНИЦЫ                                                    */}
            <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 transition-all">

        {/* 0. ДЕМО-ХАБ (НОВЫЙ) */}
        {activeTab === 'hub' && (
          <div className="max-w-5xl mx-auto px-4 py-12">
            <h2 className="text-3xl font-black text-[#0A2896] mb-3 text-center tracking-tight uppercase">Электронная очередь</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { path: '/demo/client?action=booking', icon: Calendar, title: 'Записаться онлайн', desc: 'Выберите отделение и удобное время.', roles: ['client'] },
                { path: '/demo/client?action=walkin', icon: Smartphone, title: 'Взять талон в отделении', desc: 'Получите номер электронной очереди прямо сейчас.', roles: ['client'] },
                { path: '/demo/client?action=my', icon: CheckSquare, title: 'Мои талоны', desc: 'Активные талоны и история.', roles: ['client'] },
                { path: '/demo/operator', icon: Activity, title: 'Окно оператора', desc: 'Вызов клиентов, обслуживание талонов, перевод и отмена', roles: ['employee', 'opc_chief'] },
                { path: '/demo/tv', icon: Eye, title: 'Табло зала (ТВ)', desc: 'Отображение текущей очереди, видео и вызовов с озвучкой', roles: ['employee', 'opc_chief'] },
                { path: '/demo/admin', icon: Sliders, title: 'Начальник ОПС', desc: 'Мониторинг отделения, управление окнами и приоритизацией', roles: ['opc_chief'] },
              ].filter(link => userRole && (link.roles as string[]).includes(userRole)).map(link => (
                <button 
                  key={link.path} 
                  onClick={() => navigate && navigate(link.path)} 
                  className="bg-white p-6 rounded-2xl shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all border border-blue-100/60 flex flex-col items-center text-center gap-4 group cursor-pointer"
                >
                  <div className="w-16 h-16 rounded-2xl bg-[#F0F5FF] flex items-center justify-center group-hover:scale-110 transition-transform text-[#054FA6]">
                    <link.icon className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{link.title}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{link.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

                {/* ВКЛАДКА 1: БРОНИРОВАНИЕ ТАЛОНА                                           */}
                {(activeTab === 'client-booking' || activeTab === 'client-ticket') && (
           <ClientWorkspace />
        )}
        {activeTab === 'operator' && (
          <div className="space-y-4">
            {!isOperatorRole ? (
              <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm">
                <ShieldAlert className="w-12 h-12 text-[#D92534] mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-800 mb-2">Доступ закрыт</h2>
                <p className="text-slate-600 text-sm mb-6">
                  Рабочее место оператора доступно только сотрудникам (employee) и начальнику ОПС.
                  Ваша роль: <strong className="font-mono">{currentUser?.role ?? 'не авторизован'}</strong>.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setActiveTab('hub')}
                    className="px-6 py-2.5 bg-[#003B73] text-white font-bold rounded-xl hover:bg-[#054FA6] transition-colors"
                  >
                    Вернуться в меню
                  </button>
                  <button
                    onClick={async () => { await logout(); setCurrentUser(null); }}
                    className="px-6 py-2.5 bg-white text-slate-700 border border-slate-300 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    Сменить учётную запись
                  </button>
                </div>
              </div>
            ) : (
              <>
            
            {/* Панель выбора окна оператора */}
            <div className="bg-white rounded-3xl border border-[#D2D8E2] p-4 sm:p-5 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-[#003B73] text-white font-mono font-black text-xl flex items-center justify-center shadow-md">
                    № {operatorWindowId}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-black text-base text-slate-900">{operatorSelectedWindow.name}</h2>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${operatorSelectedWindow.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-slate-200 text-slate-700 border-slate-300'}`}>
                        {operatorSelectedWindow.status === 'ACTIVE' ? 'СМЕНА АКТИВНА' : 'ОКНО ЗАКРЫТО'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Оператор: <strong className="text-slate-800">{currentUser?.email ?? operatorSelectedWindow.operator}</strong> • Обслужено за смену: {operatorSelectedWindow.servedCount} чел.
                    </p>
                  </div>
                </div>

                                <div className="flex items-center gap-2 max-w-full min-w-0">
                  <span className="text-xs font-mono text-slate-500 font-bold hidden sm:inline shrink-0">Выбор окна:</span>
                  <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl overflow-x-auto max-w-full scrollbar-thin">
                    {windows.map(w => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => {
                          setOperatorWindowId(w.id);
                          setOperatorElapsedSeconds(0);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all ${operatorWindowId === w.id ? 'bg-[#003B73] text-white shadow-sm' : 'text-slate-700 hover:bg-white'}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span>№ {w.id}</span>
                          <span className={`inline-block w-2 h-2 rounded-full ${w.status === 'ACTIVE' ? 'bg-emerald-500 shadow-sm' : 'bg-slate-300'}`} />
                        </span>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleWindowShift(operatorWindowId)}
                    className={`min-h-[38px] px-3 rounded-xl font-bold text-xs border transition-colors ${
                      operatorSelectedWindow.status === 'ACTIVE'
                        ? 'text-[#D92534] border-red-200 hover:bg-red-50'
                        : 'text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                    }`}
                  >
                    {operatorSelectedWindow.status === 'ACTIVE' ? 'Закрыть смену' : 'Открыть смену'}
                  </button>
                </div>
              </div>

                            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-600">Услуги окна:</span>
                  {SERVICES.map(srv => {
                    const isChecked = operatorSelectedWindow.services.includes(srv.id);
                    return (
                      <button
                        key={srv.id}
                        type="button"
                        onClick={() => handleToggleWindowService(operatorWindowId, srv.id)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition-all ${
                          isChecked
                            ? 'bg-blue-50 border-[#054FA6] text-[#054FA6]'
                            : 'bg-slate-50 border-slate-200 text-slate-400 line-through'
                        }`}
                      >
                        {isChecked ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                        <span>{srv.title}</span>
                      </button>
                    );
                  })}
                </div>

                <span className="font-mono text-[11px] text-slate-500">
                  Горячие клавиши: [Пробел] — вызов, [Enter] — завершение
                </span>
              </div>
            </div>

            {/* Сплит оператора */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              
              {/* Левые 7 колонок: обслуживание */}
              <div className="lg:col-span-7 space-y-4">
                
                <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold">
                      Текущий клиент у стойки Окна № {operatorWindowId}
                    </div>
                    <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-800 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                      <Clock className="w-4 h-4 text-[#003B73]" />
                      <span>{Math.floor(operatorElapsedSeconds / 60).toString().padStart(2, '0')}:{(operatorElapsedSeconds % 60).toString().padStart(2, '0')}</span>
                    </div>
                  </div>

                  {operatorCurrentTicket ? (
                    <div className="space-y-4">
                      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-mono uppercase text-[#003B73] font-bold">Талон клиента</div>
                          <div className="text-5xl sm:text-6xl font-black font-mono text-[#003B73] tracking-tight my-1">
                            {operatorCurrentTicket.number}
                          </div>
                          <div className="text-xs font-semibold text-slate-700">
                            {SERVICES.find(s => s.id === operatorCurrentTicket.serviceId)?.title || 'Почтовые услуги'}
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs font-mono sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                          <div>
                            <span className="text-slate-500 font-sans">Источник:</span>
                            <span className="font-bold text-[#054FA6] ml-1">{operatorCurrentTicket.source}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 font-sans">Трек ШПИ:</span>
                            <span className="font-bold text-slate-800 ml-1">8009 2182 0491 02</span>
                          </div>
                          <div>
                            <span className="text-slate-500 font-sans">Статус:</span>
                            <span className="font-bold text-emerald-700 ml-1">В ОБСЛУЖИВАНИИ</span>
                          </div>
                        </div>
                      </div>

                      {/* Основные кнопки управления клиентом */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        
                        {/* Вызов следующего талона (Space) с озвучкой */}
                        <button
                          type="button"
                          onClick={handleOperatorCallNext}
                          className="min-h-[50px] py-3 px-4 rounded-2xl border-2 border-[#003B73] text-[#003B73] hover:bg-blue-50 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                        >
                          <Volume2 className="w-4 h-4 text-emerald-600" />
                          <span>Вызвать след. [Space]</span>
                        </button>

                        {/* Завершение обслуживания (Enter) */}
                        <button
                          type="button"
                          onClick={handleOperatorFinish}
                          className="min-h-[50px] py-3 px-4 rounded-2xl bg-[#003B73] hover:bg-[#002d58] active:bg-[#001f3f] text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md transition-all"
                        >
                          <Check className="w-5 h-5" />
                          <span>Завершить приём [Enter]</span>
                        </button>

                      </div>

                      {/* Вспомогательные действия оператора (Озвучить, NO_SHOW, В очередь) */}
                      <div className="grid grid-cols-3 gap-2 text-xs font-semibold">
                        <button
                          type="button"
                          onClick={() => handleAnnounce(operatorCurrentTicket.number, operatorWindowId)}
                          className="min-h-[42px] p-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 flex items-center justify-center gap-1.5 font-bold"
                          title="Озвучить вызов диктором и гонгом"
                        >
                          <Volume2 className="w-4 h-4 text-emerald-700" />
                          <span>Озвучить вызов</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleOperatorNoShow}
                          className="min-h-[42px] p-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 flex items-center justify-center gap-1.5 font-bold"
                        >
                          <UserX className="w-4 h-4 text-amber-700" />
                          <span>Не явился (NO_SHOW)</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleOperatorReturnToQueue}
                          className="min-h-[42px] p-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-800 flex items-center justify-center gap-1.5"
                        >
                          <RotateCcw className="w-4 h-4 text-slate-500" />
                          <span>Вернуть в очередь</span>
                        </button>
                      </div>

                    </div>
                  ) : (
                    <div className="text-center py-12 space-y-3">
                      <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                        <UserX className="w-8 h-8" />
                      </div>
                      <div className="text-sm font-bold text-slate-800">Нет активного клиента у Окна № {operatorWindowId}</div>
                      <p className="text-xs text-slate-500 max-w-xs mx-auto">
                        Нажмите пробел или кнопку ниже для приглашения первого подходящего талона
                      </p>
                      <button
                        type="button"
                        onClick={handleOperatorCallNext}
                        className="min-h-[48px] px-6 rounded-2xl bg-[#003B73] text-white font-bold text-xs uppercase tracking-wider inline-flex items-center gap-2 shadow-md hover:bg-[#002d58]"
                      >
                        <Volume2 className="w-4 h-4 text-emerald-300" />
                        <span>Вызвать следующего клиента [Space]</span>
                      </button>
                    </div>
                  )}

                </div>

                {/* Сервисные операции стойки */}
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setIsLiveQueueModalOpen(true)}
                    className="p-3.5 rounded-2xl bg-white border border-[#D2D8E2] hover:border-[#054FA6] shadow-sm text-left transition-colors"
                  >
                    <UserPlus className="w-5 h-5 text-[#054FA6] mb-1.5" />
                    <div className="text-xs font-bold text-slate-800">+ Живая очередь</div>
                    <div className="text-[11px] text-slate-500">Клиент без смартфона</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsRedirectModalOpen(true)}
                    disabled={!operatorCurrentTicket}
                    className="p-3.5 rounded-2xl bg-white border border-[#D2D8E2] hover:border-[#054FA6] shadow-sm text-left disabled:opacity-50 transition-colors"
                  >
                    <ArrowRightLeft className="w-5 h-5 text-[#003B73] mb-1.5" />
                    <div className="text-xs font-bold text-slate-800">Перенаправить</div>
                    <div className="text-[11px] text-slate-500">В окно 1 или окно 2</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsIncidentModalOpen(true)}
                    className="p-3.5 rounded-2xl bg-white border border-[#D2D8E2] hover:border-[#D92534] shadow-sm text-left transition-colors"
                  >
                    <AlertTriangle className="w-5 h-5 text-[#D92534] mb-1.5" />
                    <div className="text-xs font-bold text-slate-800">Инцидент / Сбой</div>
                    <div className="text-[11px] text-slate-500">Зафиксировать проблему</div>
                  </button>
                </div>

              </div>

              {/* Правые 5 колонок: Очередь для данного окна */}
              <div className="lg:col-span-5 bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">Ожидают для Окна № {operatorWindowId}</h3>
                    <p className="text-[11px] text-slate-500">Сортировка по Queue Score</p>
                  </div>
                  <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-[#054FA6]">
                    {queueScoring.filter(t => operatorSelectedWindow.services.includes(t.serviceId)).length} талонов
                  </span>
                </div>

                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                  {queueScoring
                    .filter(t => operatorSelectedWindow.services.includes(t.serviceId))
                    .map((t, idx) => (
                      <div
                        key={t.id}
                        className={`p-3 rounded-2xl border text-xs flex items-center justify-between transition-all ${
                          idx === 0
                            ? 'bg-blue-50/70 border-blue-200 ring-1 ring-blue-400'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900 text-sm">{t.number}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-white border border-slate-300">
                              {t.source}
                            </span>
                            {t.isStarved && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold border border-amber-300 flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3" /> Starvation
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-600 mt-1 font-sans">
                            {SERVICES.find(s => s.id === t.serviceId)?.title}
                          </div>
                        </div>

                        <div className="text-right font-mono">
                          <div className="text-xs font-bold text-[#054FA6]">{t.score} pts</div>
                          <div className="text-[11px] text-slate-500">~{t.waitMinutes} мин</div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

            </div>

              </>
            )}
          </div>
        )}

                {/* ВКЛАДКА 4: НАЧАЛЬНИК ОПС И ПОЛИТИКА ОЧЕРЕДИ                              */}
                {activeTab === 'admin' && (
          <div className="space-y-4">
            {!isAdminRole ? (
              <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm">
                <ShieldAlert className="w-12 h-12 text-[#D92534] mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-800 mb-2">Доступ закрыт</h2>
                <p className="text-slate-600 text-sm mb-6">
                  Панель администратора доступна только начальнику ОПС (opc_chief).
                  Ваша роль: <strong className="font-mono">{currentUser?.role ?? 'не авторизован'}</strong>.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setActiveTab('hub')}
                    className="px-6 py-2.5 bg-[#003B73] text-white font-bold rounded-xl hover:bg-[#054FA6] transition-colors"
                  >
                    Вернуться в меню
                  </button>
                  <button
                    onClick={async () => { await logout(); setCurrentUser(null); }}
                    className="px-6 py-2.5 bg-white text-slate-700 border border-slate-300 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    Сменить учётную запись
                  </button>
                </div>
              </div>
            ) : (
              <>
            
            {/* Заголовок */}
            <div className="bg-white rounded-3xl border border-[#D2D8E2] p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3">
                <PochtaEmblem className="w-10 h-10" bg="#003B73" fg="#FFFFFF" />
                <div>
                  <div className="text-xs font-mono uppercase text-slate-500 font-semibold">Мониторинг ОПС • Главпочтамт</div>
                  <h2 className="text-base sm:text-lg font-black text-slate-900">Дашборд начальника ОПС 390000 & Конфигуратор Queue Engine</h2>
                </div>
              </div>

              {/* Подвкладки админки */}
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-2xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setAdminSubTab('overview')}
                  className={`px-3 py-1.5 rounded-xl transition-all ${adminSubTab === 'overview' ? 'bg-white text-[#003B73] shadow-sm' : 'text-slate-600'}`}
                >
                  Мониторинг & KPI
                </button>
                <button
                  type="button"
                  onClick={() => setAdminSubTab('policy')}
                  className={`px-3 py-1.5 rounded-xl transition-all ${adminSubTab === 'policy' ? 'bg-white text-[#003B73] shadow-sm' : 'text-slate-600'}`}
                >
                  Queue Policy
                </button>
                <button
                  type="button"
                  onClick={() => setAdminSubTab('anomalies')}
                  className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${adminSubTab === 'anomalies' ? 'bg-white text-[#D92534] shadow-sm' : 'text-slate-600'}`}
                >
                  <span>Аномалии</span>
                  <span className="w-4 h-4 rounded-full bg-red-100 text-red-700 text-[10px] flex items-center justify-center font-mono">
                    {anomaliesList.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setAdminSubTab('audit')}
                  className={`px-3 py-1.5 rounded-xl transition-all ${adminSubTab === 'audit' ? 'bg-white text-[#003B73] shadow-sm' : 'text-slate-600'}`}
                >
                  Аудит талонов
                </button>
                <button
                  type="button"
                  onClick={() => setAdminSubTab('users')}
                  className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${adminSubTab === 'users' ? 'bg-white text-[#003B73] shadow-sm' : 'text-slate-600'}`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Пользователи</span>
                </button>
              </div>
            </div>

            {/* Карточки KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 font-mono">
              <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                <div className="text-xs text-slate-500 uppercase">Ср. ожидание</div>
                <div className="text-2xl font-black text-slate-900 mt-1">
                  {overview?.metrics ? `${overview.metrics.avgWaitTimeMinutes} мин` : '0 мин'}
                </div>
                <div className="text-xs text-emerald-700 font-semibold mt-1 font-sans flex items-center gap-1">
                  {overview?.metrics && overview.metrics.avgWaitTimeMinutes <= 8 ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 inline" />
                      <span>В нормативе (&lt; 8 мин)</span>
                    </>
                  ) : (
                    <span>Мониторинг SLA</span>
                  )}
                </div>
              </div>

              <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                <div className="text-xs text-slate-500 uppercase">Макс. ожидание</div>
                <div className="text-2xl font-black text-amber-700 mt-1">
                  {overview?.metrics ? `${overview.metrics.maxWaitTimeMinutes} мин` : '0 мин'}
                </div>
                <div className="text-xs text-slate-500 mt-1 font-sans flex items-center gap-1">
                  {overview?.metrics && overview.metrics.maxWaitTimeMinutes > 15 ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 inline" />
                      <span className="text-amber-700 font-semibold">Защита от голодания</span>
                    </>
                  ) : (
                    <span>В норме</span>
                  )}
                </div>
              </div>

              <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                <div className="text-xs text-slate-500 uppercase">В зале ожидания</div>
                <div className="text-2xl font-black text-[#054FA6] mt-1">
                  {overview?.metrics ? overview.metrics.waitingClientsCount : tickets.filter(t => t.status === 'WAITING').length} чел.
                </div>
                <div className="text-xs text-slate-500 mt-1 font-sans">
                  {overview?.metrics ? overview.metrics.activeWindowsCount : windows.filter(w => w.status === 'ACTIVE').length} окна в работе
                </div>
              </div>

              <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                <div className="text-xs text-slate-500 uppercase">Обслужено за смену</div>
                <div className="text-2xl font-black text-slate-900 mt-1">
                  {overview?.metrics ? overview.metrics.servedTodayCount : windows.reduce((acc, w) => acc + w.servedCount, 0)} чел.
                </div>
                <div className="text-xs text-emerald-700 font-semibold mt-1 font-sans">За текущий день</div>
              </div>

              <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm col-span-2 lg:col-span-1">
                <div className="text-xs text-slate-500 uppercase">Неявки (NO_SHOW)</div>
                <div className="text-2xl font-black text-[#D92534] mt-1">
                  {overview?.anomalies ? overview.anomalies.filter((a: any) => a.type === 'NO_SHOW').length : tickets.filter(t => t.status === 'NO_SHOW').length} талона
                </div>
                <div className="text-xs text-slate-500 mt-1 font-sans">Окна освобождены</div>
              </div>
            </div>

            {/* Подвкладка: Обзор и окна */}
            {adminSubTab === 'overview' && (
              <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-bold text-sm text-slate-900">Управление окнами ОПС и распределение услуг</h3>
                  <span className="text-xs font-mono text-slate-500">{windows.length} окна зарегистрировано</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px]">
                      <tr>
                        <th className="p-2.5">Окно</th>
                        <th className="p-2.5">Оператор</th>
                        <th className="p-2.5">Услуги</th>
                        <th className="p-2.5">Статус</th>
                        <th className="p-2.5">Клиент</th>
                        <th className="p-2.5">Обслужено</th>
                        <th className="p-2.5">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {windows.map(win => (
                        <tr key={win.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold text-slate-900">{win.name}</td>
                          <td className="p-2.5 font-sans">{win.operator}</td>
                          <td className="p-2.5 font-sans text-slate-600">
                            {win.services.map(s => SERVICES.find(srv => srv.id === s)?.title.split(' ')[0]).join(', ')}
                          </td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${win.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                              {win.status === 'ACTIVE' ? 'В РАБОТЕ' : 'ЗАКРЫТО'}
                            </span>
                          </td>
                          <td className="p-2.5 font-bold text-[#054FA6]">{win.currentTicketId || '—'}</td>
                          <td className="p-2.5">{win.servedCount} чел</td>
                          <td className="p-2.5">
                            <button
                              type="button"
                              onClick={() => handleToggleWindowShift(win.id)}
                              className="px-2.5 py-1 rounded-lg border text-[11px] font-bold hover:bg-slate-100 transition-colors"
                            >
                              {win.status === 'ACTIVE' ? 'Закрыть' : 'Открыть'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Подвкладка: Параметры Queue Policy */}
            {adminSubTab === 'policy' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">Конфигуратор весовых коэффициентов</h3>
                      <p className="text-[11px] font-mono text-slate-500">Формула: Score = W_channel + (WaitMin * K_wait) + StarvationBonus</p>
                    </div>
                    <span className="text-xs font-mono font-bold bg-blue-50 text-[#054FA6] px-2.5 py-0.5 rounded-full border border-blue-200">v3.2</span>
                  </div>

                  <div className="space-y-4 text-xs">
                    <div>
                      <div className="flex justify-between font-semibold text-slate-800 mb-1">
                        <span>Вес: Предварительная запись (W_apt)</span>
                        <span className="font-mono text-[#054FA6] font-bold">{policyConfig.weightAppointment}</span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="3.0"
                        step="0.1"
                        value={policyConfig.weightAppointment}
                        onChange={(e) => setPolicyConfig(prev => ({ ...prev, weightAppointment: parseFloat(e.target.value) }))}
                        className="w-full accent-[#054FA6]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between font-semibold text-slate-800 mb-1">
                        <span>Вес: QR-код со смартфона (W_qr)</span>
                        <span className="font-mono text-[#054FA6] font-bold">{policyConfig.weightQr}</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={policyConfig.weightQr}
                        onChange={(e) => setPolicyConfig(prev => ({ ...prev, weightQr: parseFloat(e.target.value) }))}
                        className="w-full accent-[#054FA6]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between font-semibold text-slate-800 mb-1">
                        <span>Вес: Живая очередь без смартфона (W_live)</span>
                        <span className="font-mono text-[#054FA6] font-bold">{policyConfig.weightLive}</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={policyConfig.weightLive}
                        onChange={(e) => setPolicyConfig(prev => ({ ...prev, weightLive: parseFloat(e.target.value) }))}
                        className="w-full accent-[#054FA6]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between font-semibold text-slate-800 mb-1">
                        <span>Прирост за минуту ожидания (K_wait)</span>
                        <span className="font-mono text-[#054FA6] font-bold">+{policyConfig.waitMinutesFactor}</span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="0.4"
                        step="0.05"
                        value={policyConfig.waitMinutesFactor}
                        onChange={(e) => setPolicyConfig(prev => ({ ...prev, waitMinutesFactor: parseFloat(e.target.value) }))}
                        className="w-full accent-[#054FA6]"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        showToast('Параметры Queue Policy успешно применены ко всем окнам');
                        logAudit('POLICY_UPDATE', 'Обновлены весовые коэффициенты алгоритма очереди');
                      }}
                      className="w-full min-h-[44px] rounded-2xl bg-[#003B73] text-white font-bold text-xs uppercase tracking-wider shadow-sm hover:bg-[#002d58]"
                    >
                      Сохранить и применить к отделению
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-5 bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-4 shadow-sm">
                  <h4 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">Гарантии SLA и защита от голодания</h4>
                  
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-amber-700" />
                      <span>Starvation Guard (15 минут)</span>
                    </div>
                    <p className="text-[11px] leading-snug">
                      При превышении порога ожидания в 15 минут талон получает приоритетный бонус +10 баллов и гарантированно назначается в первое освободившееся окно.
                    </p>
                  </div>

                  <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-blue-900 text-xs space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-[#054FA6]" />
                      <span>SLA предварительной записи</span>
                    </div>
                    <p className="text-[11px] leading-snug">
                      Клиенты по предварительной записи получают наивысший приоритет в окне ±10 минут от назначенного слота. При опоздании приоритет затухает плавно, не срывая очередь.
                    </p>
                  </div>
                </div>
              </div>
            )}

                        {adminSubTab === 'anomalies' && (
              <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">Реестр отклонений и незавершенных талонов</h3>
                    <p className="text-[11px] text-slate-500">Контроль неявок, задержек и операционных сбоев</p>
                  </div>
                  <span className="font-mono text-xs font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
                    {anomaliesList.length} активных аномалий
                  </span>
                </div>

                <div className="space-y-2">
                  {anomaliesList.length > 0 ? (
                    anomaliesList.map(item => (
                      <div key={item.id} className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white font-mono shrink-0 ${item.severity === 'danger' ? 'bg-[#D92534]' : item.severity === 'warning' ? 'bg-amber-600' : 'bg-blue-600'}`}>
                            {item.ticket.substring(0, 3)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900">{item.ticket}</span>
                              <span className="font-bold px-2 py-0.5 rounded text-[10px] bg-white border border-slate-300">
                                {item.badge}
                              </span>
                            </div>
                            <p className="text-slate-600 mt-0.5">{item.details}</p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            showToast(`Аномалия по талону ${item.ticket} обработана`);
                            logAudit('ANOMALY_RESOLVED', `Руководитель обработал отклонение по талону ${item.ticket}`);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-bold text-[11px] shrink-0"
                        >
                          Обработать
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-xs text-slate-500">
                      Отклонений и инцидентов не зафиксировано
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Подвкладка: Журнал аудита */}
            {adminSubTab === 'audit' && (
              <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">Журнал аудита талонов (Ticket Audit Trail)</h3>
                    <p className="text-[11px] text-slate-500">Фиксация всех вызовов, озвучиваний и изменений состояний</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => showToast('Журнал аудита выгружен в формате CSV')}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 hover:bg-slate-50 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Экспорт CSV</span>
                  </button>
                </div>

                <div className="space-y-1.5 text-xs font-mono max-h-72 overflow-y-auto pr-1">
                  {auditEvents.map(evt => (
                    <div key={evt.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <div>
                        <span className="text-slate-500 font-bold">{evt.time}</span>
                        <span className="ml-2 font-bold text-[#054FA6]">[{evt.type}]</span>
                        <span className="ml-2 text-slate-800 font-sans">{evt.text}</span>
                      </div>
                      <span className="text-slate-400 text-[10px]">Audit Engine</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {adminSubTab === 'users' && (
              <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Users className="w-5 h-5 text-[#003B73]" />
                    <span>Управление доступом сотрудников (IAM)</span>
                  </h3>
                  <button onClick={loadAdminUsers} className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 hover:bg-slate-50 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-[#003B73]" />
                    <span>Обновить список</span>
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-700">
                    <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500 rounded-t-xl">
                      <tr>
                        <th className="px-4 py-3 rounded-tl-xl">Email</th>
                        <th className="px-4 py-3">Текущая роль</th>
                        <th className="px-4 py-3">Терминал?</th>
                        <th className="px-4 py-3 rounded-tr-xl text-right">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-xs">
                      {adminUsers.map(u => (
                        <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-900">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-md text-[10px] font-bold ${
                              u.role === 'opc_chief' ? 'bg-[#D92534]/10 text-[#D92534] border border-[#D92534]/20' :
                              u.role === 'employee' ? 'bg-[#003B73]/10 text-[#003B73] border border-[#003B73]/20' :
                              'bg-slate-200 text-slate-600 border border-slate-300'
                            }`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {u.isTerminal ? <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" /> : <span className="text-slate-300">-</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <select
                              value={u.role}
                              onChange={async (e) => {
                                try {
                                  await changeUserRole(u.id, e.target.value);
                                  showToast(`Роль для ${u.email} изменена на ${e.target.value}`);
                                  loadAdminUsers();
                                } catch (err: any) {
                                  showToast(`Ошибка: ${err.message}`);
                                }
                              }}
                              className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs"
                              disabled={u.email === 'admin@pochta.local'}
                            >
                              <option value="client">Client</option>
                              <option value="employee">Employee</option>
                              <option value="opc_chief">Admin (Chief)</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
              </>
            )}
          </div>
        )}

                {/* ВКЛАДКА 5: ТАБЛО ВЫЗОВА В ЗАЛЕ (ТВ, Высокий контраст, Голосовой диктор)   */}
                        {/* ВКЛАДКА 5: ТАБЛО ВЫЗОВА В ЗАЛЕ (ТВ, Светлый чистый дизайн, Высокая видимость) */}
                {activeTab === 'tv' && (isOperatorRole ? (
          <div className="bg-[#F4F7FB] text-slate-900 rounded-3xl p-6 sm:p-8 border border-[#DCE3EC] shadow-xl space-y-6">
            
            {/* Шапка информационного табло в фирменном синем цвете */}
            <div className="bg-[#003B73] text-white rounded-2xl p-4 sm:p-5 shadow-md flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <PochtaEmblem className="w-11 h-11" bg="#FFFFFF" fg="#003B73" />
                <div>
                  <div className="text-sm font-bold tracking-wider uppercase text-white flex items-center gap-2">
                    <span>ПОЧТА РОССИИ</span>
                    <span className="text-blue-200 text-xs font-normal">• ИНФОРМАЦИОННОЕ ТАБЛО ВЫЗОВА</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={toggleTvFullscreen}
                  className="px-3.5 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-xs font-mono font-bold flex items-center gap-2 text-white transition-colors"
                >
                  {isFullscreenTv ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  <span>{isFullscreenTv ? 'Оконный режим' : 'Полный экран'}</span>
                </button>

                <div className="text-right font-mono border-l border-white/20 pl-4">
                  <div className="text-3xl sm:text-4xl font-black tracking-wider text-white">
                    {currentTime.toTimeString().split(' ')[0]}
                  </div>
                  <div className="text-xs text-blue-200">Открыто до {BRANCH_CONFIG.closeTimeStr}</div>
                </div>
              </div>
            </div>

            {/* Доминантный блок вызова */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Левые 8 колонок: текущие вызовы */}
              <div className="lg:col-span-8 space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[#5D687A] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#00823C]"></span>
                    <span>СЕЙЧАС ОБСЛУЖИВАЮТСЯ У СТОЕК</span>
                  </div>
                </div>

                <div className="space-y-4">
                  
                  {/* Главный активный вызов: Окно оператора */}
                  <div className={`p-6 sm:p-8 rounded-3xl bg-white border-2 transition-all flex items-center justify-between shadow-[0_10px_30px_rgba(0,59,115,0.06)] relative overflow-hidden ${
                    currentAnnouncement?.isSpeaking && currentAnnouncement.windowId === operatorWindowId
                      ? 'border-[#0055A5] ring-4 ring-blue-500/15'
                      : 'border-[#0055A5]'
                  }`}>
                    <div>
                      <div className="text-xs font-mono uppercase text-[#054FA6] font-bold tracking-wider">
                        Талон клиента
                      </div>
                      <div className="text-6xl sm:text-8xl font-black font-mono text-[#003B73] tracking-tight mt-1">
                        {operatorCurrentTicket ? operatorCurrentTicket.number : '—'}
                      </div>
                      <div className="text-xs sm:text-sm text-slate-600 font-semibold mt-1.5">
                        {operatorCurrentTicket ? (SERVICES.find(s => s.id === operatorCurrentTicket.serviceId)?.title || 'Почтовые услуги') : 'Ожидание вызова'}
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-2 px-2">
                      <ArrowRight className="w-10 h-10 sm:w-12 sm:h-12 text-[#054FA6]" />
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-mono uppercase text-[#054FA6] font-bold tracking-wider">
                        Пройдите к окну
                      </div>
                      <div className="mt-1">
                        <span className="inline-block bg-[#003B73] text-white px-5 sm:px-6 py-2 rounded-2xl text-5xl sm:text-7xl font-black font-mono tracking-tight shadow-md">
                          ОКНО {operatorWindowId}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-2 font-mono">Оператор: {operatorSelectedWindow.operator}</div>
                    </div>
                  </div>

                  {/* Вторичные вызовы: остальные окна (без окна оператора) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {windows.filter(w => w.id !== operatorWindowId).map(win => {
                      const called = getWindowCurrentTicket(win.id);
                      return (
                        <div key={win.id} className="p-4 sm:p-5 rounded-2xl bg-white border border-[#DCE3EC] shadow-sm flex items-center justify-between">
                          <div>
                            <div className="text-xs font-mono uppercase text-slate-500 font-semibold">Талон</div>
                            <div className="text-3xl sm:text-4xl font-black font-mono text-slate-800">
                              {called ? called.number : '—'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <ArrowRight className="w-5 h-5 text-slate-400" />
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-mono uppercase text-slate-500 font-semibold">Окно</div>
                            <div className="text-2xl sm:text-3xl font-black font-mono text-[#003B73]">ОКНО {win.id}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                </div>
              </div>

              {/* Правые 4 колонки: следующие в очереди и QR для входа */}
              <div className="lg:col-span-4 space-y-4">
                
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-[#5D687A]">
                    СЛЕДУЮЩИЕ В ОЧЕРЕДИ
                  </div>
                  <div className="bg-white rounded-2xl p-4 border border-[#DCE3EC] shadow-sm space-y-1 font-mono">
                    {queueScoring.slice(0, 5).map(t => (
                      <div key={t.id} className="flex items-center justify-between text-xs py-2 border-b border-slate-100 last:border-0">
                        <span className="font-black text-[#003B73] text-base">{t.number}</span>
                        <span className="text-slate-600 font-sans text-xs truncate max-w-[130px]">
                          {SERVICES.find(s => s.id === t.serviceId)?.title.split(' ')[0]}
                        </span>
                        <span className="text-[#054FA6] bg-[#EBF3FC] font-semibold text-[11px] px-2 py-0.5 rounded">
                          ~{calculatedQueueMetrics[t.id]?.etaMinutes || 4} мин
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>

          </div>
        ) : (
          <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm max-w-md mx-auto">
            <ShieldAlert className="w-12 h-12 text-[#D92534] mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-800 mb-2">Доступ закрыт</h2>
            <p className="text-slate-600 text-sm mb-6">Табло зала доступно только сотрудникам отделения.</p>
            <button onClick={() => setActiveTab('hub')} className="px-6 py-2.5 bg-[#003B73] text-white font-bold rounded-xl hover:bg-[#054FA6] transition-colors">
              Вернуться в меню
            </button>
          </div>
        ))}

                {/* ВКЛАДКА 6: ТЕРМИНАЛ САМООБСЛУЖИВАНИЯ (КИОСК В ЗАЛЕ)                       */}
                {activeTab === 'kiosk' && (
          <div className="max-w-3xl mx-auto space-y-6">
            
            <div className="bg-[#003B73] text-white rounded-3xl p-6 sm:p-8 text-center space-y-2 border border-[#003B73] shadow-lg relative overflow-hidden">
              <PochtaEmblem className="w-14 h-14 mx-auto drop-shadow-md" bg="#003B73" fg="#FFFFFF" />
              <h2 className="text-2xl sm:text-3xl font-black">Терминал самообслуживания ОПС 390000</h2>
              <p className="text-sm text-blue-200 max-w-md mx-auto">
                Коснитесь экрана для выбора необходимой услуги и мгновенного получения талона
              </p>
            </div>

            {/* Большие сенсорные плитки 2х2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {SERVICES.map(srv => (
                <button
                  key={srv.id}
                  type="button"
                  onClick={() => handleKioskSelectService(srv.id)}
                  className="bg-white rounded-3xl p-6 border-2 border-[#D2D8E2] hover:border-[#054FA6] hover:shadow-xl active:scale-[0.98] transition-all text-left flex flex-col justify-between h-52 group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="w-12 h-12 rounded-2xl bg-blue-50 text-[#054FA6] font-mono font-black text-2xl flex items-center justify-center group-hover:bg-[#054FA6] group-hover:text-white transition-colors">
                        {srv.prefix}
                      </span>
                      <span className="font-mono text-xs px-2.5 py-1 rounded-xl bg-slate-100 text-slate-600 font-bold">
                        ~{srv.avgMinutes} мин
                      </span>
                    </div>
                    <div className="text-lg font-black text-slate-900 leading-tight mb-1">{srv.title}</div>
                    <div className="text-xs text-slate-500 leading-snug">{srv.subtitle}</div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-[#054FA6]">
                    <span>Нажмите для печати талона</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              ))}
            </div>

          </div>
        )}

                {/* ВКЛАДКА 7: АРХИТЕКТУРА И ДОРОЖНАЯ КАРТА            */}
                {activeTab === 'roadmap' && (
          <div className="space-y-5 max-w-4xl mx-auto">
            
            <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 sm:p-6 shadow-sm">
              <div className="flex items-center gap-2.5 mb-2">
                <Sparkles className="w-5 h-5 text-emerald-600" />
                <h3 className="font-black text-base text-slate-900">Архитектурные этапы развития системы</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Разработанная система управления очередью Почты России нового поколения (СУО 3.0) полностью удовлетворяет всем функциональным требованиям ТЗ: от мобильного клиента без терминалов до масштабирования на 40 000 отделений связи.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              
              <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-2.5 shadow-sm">
                <div className="font-bold text-[#003B73] flex items-center gap-2 text-sm">
                  <span className="w-6 h-6 rounded-lg bg-blue-100 text-[#003B73] flex items-center justify-center font-mono font-black">1</span>
                  <span>Этап 1: Базовое ядро и очереди</span>
                </div>
                <ul className="space-y-1 text-slate-600 list-disc list-inside">
                  <li>Клиентский веб-интерфейс, рабочее место оператора, админка ОПС</li>
                  <li>Go Backend + PostgreSQL + REST API + WebSocket шина событий</li>
                  <li>Docker Compose, healthcheck и readiness пробы</li>
                </ul>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-2.5 shadow-sm">
                <div className="font-bold text-[#003B73] flex items-center gap-2 text-sm">
                  <span className="w-6 h-6 rounded-lg bg-blue-100 text-[#003B73] flex items-center justify-center font-mono font-black">2</span>
                  <span>Этап 2: Окна и маршрутизация</span>
                </div>
                <ul className="space-y-1 text-slate-600 list-disc list-inside">
                  <li>Выдача живой очереди (серия Ж) оператором без смартфона</li>
                  <li>Перенаправление клиентов между окнами и возврат в очередь</li>
                  <li>Корректное поведение при закрытии окна с активным клиентом</li>
                </ul>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-2.5 shadow-sm">
                <div className="font-bold text-[#003B73] flex items-center gap-2 text-sm">
                  <span className="w-6 h-6 rounded-lg bg-blue-100 text-[#003B73] flex items-center justify-center font-mono font-black">3</span>
                  <span>Этап 3: Детерминированный планировщик</span>
                </div>
                <ul className="space-y-1 text-slate-600 list-disc list-inside">
                  <li>Настраиваемые веса (W_apt, W_qr, W_live, K_wait) в конфигураторе</li>
                  <li>Защита от голодания (Starvation Guard): эскалация при ожидании &gt; 15 мин</li>
                  <li>Фиксация неявки NO_SHOW и освобождение ресурса стойки</li>
                </ul>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-2.5 shadow-sm">
                <div className="font-bold text-[#003B73] flex items-center gap-2 text-sm">
                  <span className="w-6 h-6 rounded-lg bg-blue-100 text-[#003B73] flex items-center justify-center font-mono font-black">4</span>
                  <span>Этап 4: Отказоустойчивость и геосервисы</span>
                </div>
                <ul className="space-y-1 text-slate-600 list-disc list-inside">
                  <li>Прогноз «Успею ли сегодня?» с предложением соседнего ОПС</li>
                  <li>Автономный офлайн-режим и локальный кэш при потере связи</li>
                  <li>Двухтональный гонг и естественный голосовой диктор вызова</li>
                  <li>Версия для слабовидящих и киоск-терминал самообслуживания</li>
                </ul>
              </div>

            </div>

          </div>
        )}

      </main>

            {/* МОДАЛЬНЫЕ ОКНА                                                            */}
      
      {/* Модалка настроек аудио и диктора */}
      {isAudioSettingsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 sm:p-6 max-w-md w-full border border-slate-200 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#054FA6] flex items-center justify-center">
                  <Volume2 className="w-5 h-5" />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">Параметры аудио и диктора СУО</h4>
              </div>
              <button onClick={() => setIsAudioSettingsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              
              {/* Переключатель гонга */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="font-bold text-slate-900">Двухтональный гонг ОПС</div>
                  <div className="text-[11px] text-slate-500">Официальный звуковой сигнал вызова (Web Audio)</div>
                </div>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="w-5 h-5 accent-[#054FA6]"
                />
              </div>

              {/* Переключатель диктора */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="font-bold text-slate-900">Голосовой диктор на русском языке</div>
                  <div className="text-[11px] text-slate-500">«Клиент с талоном ... подойдите к окну ...»</div>
                </div>
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(e) => setVoiceEnabled(e.target.checked)}
                  className="w-5 h-5 accent-[#054FA6]"
                />
              </div>

              {/* Автоматический вызов */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="font-bold text-slate-900">Авто-озвучивание при [Space]</div>
                  <div className="text-[11px] text-slate-500">Озвучивать сразу при нажатии вызова оператором</div>
                </div>
                <input
                  type="checkbox"
                  checked={autoAnnounceCalls}
                  onChange={(e) => setAutoAnnounceCalls(e.target.checked)}
                  className="w-5 h-5 accent-[#054FA6]"
                />
              </div>

              {/* Выбор установленного русского голоса */}
              {availableVoices.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      Голос диктора системы:
                    </label>
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">
                      Ранжирован по естественности
                    </span>
                  </div>
                  <select
                    value={selectedVoiceName}
                    onChange={(e) => setSelectedVoiceName(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 min-h-[40px] font-mono bg-white text-slate-900"
                  >
                    {availableVoices.map((v, idx) => (
                      <option key={v.name} value={v.name}>
                        {idx === 0 ? '[Естественный голос] ' : ''}{v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Скорость диктора */}
              <div>
                <div className="flex justify-between font-semibold text-slate-800 mb-1">
                  <span>Скорость речи диктора</span>
                  <span className="font-mono text-[#054FA6] font-bold">{speechRate}x (оптимум 0.88x)</span>
                </div>
                <input
                  type="range"
                  min="0.75"
                  max="1.2"
                  step="0.02"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                  className="w-full accent-[#054FA6]"
                />
              </div>

              {/* Кнопка тестирования фразы */}
              <button
                type="button"
                onClick={() => handleAnnounce('А-042', 3)}
                className="w-full min-h-[44px] rounded-2xl bg-[#003B73] hover:bg-[#002d58] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow"
              >
                <Play className="w-4 h-4 text-emerald-300" />
                <span>Протестировать вызов (гонг + диктор)</span>
              </button>

            </div>
          </div>
        </div>
      )}

      {/* Модалка чека киоска */}
      {isKioskSlipModalOpen && kioskCreatedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-200 shadow-2xl text-center space-y-4 animate-in fade-in">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-mono uppercase text-[#003B73] font-bold">Талон сформирован</div>
              <div className="text-5xl font-black font-mono text-[#003B73] my-1">
                {kioskCreatedTicket.number}
              </div>
              <div className="text-xs text-slate-600 font-semibold">
                {SERVICES.find(s => s.id === kioskCreatedTicket.serviceId)?.title}
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-snug">
              Пожалуйста, сохраните номер талона и ожидайте звукового вызова к окну на главном табло в зале.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsKioskSlipModalOpen(false);
                  setActiveTab('client-ticket');
                }}
                className="flex-1 min-h-[44px] rounded-2xl bg-[#054FA6] text-white font-bold text-xs"
              >
                Смотреть талон
              </button>
              <button
                type="button"
                onClick={() => setIsKioskSlipModalOpen(false)}
                className="px-4 min-h-[44px] rounded-2xl bg-slate-100 text-slate-700 font-bold text-xs"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка живой очереди */}
      {isLiveQueueModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full border border-slate-200 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 className="font-bold text-slate-900 text-sm">Выдача талона живой очереди (серия Ж)</h4>
              <button onClick={() => setIsLiveQueueModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-snug">
              Используется для пожилых граждан или клиентов без смартфона. Талон получит базовый приоритет и защиту от голодания.
            </p>

            <div className="space-y-2">
              {SERVICES.map(srv => (
                <button
                  key={srv.id}
                  type="button"
                  onClick={() => handleAddLiveQueue(srv.id)}
                  className="w-full p-3 rounded-2xl border border-slate-200 hover:border-[#054FA6] hover:bg-blue-50 text-left text-xs font-semibold flex items-center justify-between transition-colors"
                >
                  <span>{srv.title}</span>
                  <span className="font-mono text-slate-400 font-bold">+Ж</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsLiveQueueModalOpen(false)}
              className="w-full min-h-[42px] rounded-2xl bg-slate-100 font-bold text-xs text-slate-700 hover:bg-slate-200"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Модалка перенаправления */}
      {isRedirectModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full border border-slate-200 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 className="font-bold text-slate-900 text-sm">Перенаправление клиента</h4>
              <button onClick={() => setIsRedirectModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-snug">
              Выберите целевое окно для обслуживания талона <strong>{operatorCurrentTicket?.number}</strong>:
            </p>

            <div className="space-y-2 text-xs">
              {windows.filter(w => w.id !== operatorWindowId).map(w => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => handleRedirectTicket(w.id)}
                  className="w-full min-h-[46px] p-3 rounded-2xl border border-slate-200 hover:border-[#054FA6] hover:bg-blue-50 font-semibold text-left flex items-center justify-between"
                >
                  <span>{w.name} • {w.operator}</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${w.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                    {w.status === 'ACTIVE' ? 'АКТИВНО' : 'ЗАКРЫТО'}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsRedirectModalOpen(false)}
              className="w-full min-h-[42px] rounded-2xl bg-slate-100 font-bold text-xs text-slate-700 hover:bg-slate-200"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Модалка фиксации инцидента */}
      {isIncidentModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full border border-slate-200 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 className="font-bold text-[#D92534] text-sm flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Фиксация инцидента
              </h4>
              <button onClick={() => setIsIncidentModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">Категория инцидента:</label>
              <select className="w-full text-xs p-3 rounded-xl border border-slate-300 min-h-[44px]">
                <option>Сбой сканера штрихкодов / весов</option>
                <option>Зависание локальной сети ОПС</option>
                <option>Закончились почтовые коробки / упаковка</option>
                <option>Конфликтная ситуация / вызов старшего смены</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsIncidentModalOpen(false);
                showToast('Инцидент зафиксирован и направлен руководителю смены');
                logAudit('INCIDENT', `Оператор Окна № ${operatorWindowId} зафиксировал технический инцидент`);
              }}
              className="w-full min-h-[44px] rounded-2xl bg-[#D92534] hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider shadow"
            >
              Отправить в журнал руководителя
            </button>
          </div>
        </div>
      )}

      {/* Модалка закрытия окна */}
      {isCloseWindowModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full border border-slate-200 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 className="font-bold text-slate-900 text-sm">Закрытие Окна № {operatorWindowId}</h4>
              <button onClick={() => setIsCloseWindowModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-snug">
              При завершении смены система защищает активного клиента от потери:
            </p>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setIsCloseWindowModalOpen(false);
                  handleOperatorFinish();
                  setWindows(prev => prev.map(w => w.id === operatorWindowId ? { ...w, status: 'CLOSED' } : w));
                  showToast(`Окно № ${operatorWindowId} закрыто после завершения обслуживания`);
                  logAudit('WINDOW_CLOSED', `Окно № ${operatorWindowId} завершило смену`);
                }}
                className="w-full min-h-[44px] p-2.5 rounded-2xl bg-[#003B73] text-white text-xs font-bold text-center"
              >
                Завершить текущего и закрыть окно
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsCloseWindowModalOpen(false);
                  handleOperatorReturnToQueue();
                  setWindows(prev => prev.map(w => w.id === operatorWindowId ? { ...w, status: 'CLOSED' } : w));
                  showToast(`Клиент возвращен в очередь, Окно № ${operatorWindowId} закрыто`);
                  logAudit('WINDOW_CLOSED', `Окно № ${operatorWindowId} закрыто с возвратом очереди`);
                }}
                className="w-full min-h-[44px] p-2.5 rounded-2xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-800 text-center"
              >
                Вернуть клиента в очередь и закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg text-slate-800">
                {authMode === 'login' ? 'Вход в систему' : 'Регистрация'}
              </h3>
              <button onClick={() => setIsAuthModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
              const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
              try {
                if (authMode === 'login') {
                  await login(email, password);
                } else {
                  await register(email, password);
                  await login(email, password);
                }
                const user = await getMe();
                setCurrentUser(user);
                setIsAuthModalOpen(false);
                showToast(authMode === 'login' ? 'Вы успешно вошли' : 'Регистрация успешна');
              } catch (err: any) {
                showToast(`Ошибка: ${err.message}`);
              }
            }} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
                <input name="email" type="email" required className="w-full px-3 py-2 border rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Пароль</label>
                <input name="password" type="password" required minLength={6} className="w-full px-3 py-2 border rounded-xl" />
              </div>
              <button type="submit" className="w-full py-2.5 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-xl font-bold transition-colors">
                {authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
              </button>
            </form>
            
            <div className="mt-4 text-center">
              <button type="button" onClick={() => setAuthMode(m => m === 'login' ? 'register' : 'login')} className="text-xs text-blue-600 hover:underline">
                {authMode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
