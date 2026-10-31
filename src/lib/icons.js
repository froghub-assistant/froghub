// The display's icons, each as a pair: Lucide's outline (the default) and Phosphor's duotone version, for Settings →
// Icons → Two-tone. Icon.svelte picks one. Named after the Lucide icon, so `<Icon of={I.Mic} />` reads like `<Mic />`.
import * as L from '@lucide/svelte'
import Alarm from 'phosphor-svelte/lib/AlarmIcon'
import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwiseIcon'
import ArrowsIn from 'phosphor-svelte/lib/ArrowsInIcon'
import ArrowsOut from 'phosphor-svelte/lib/ArrowsOutIcon'
import Check from 'phosphor-svelte/lib/CheckIcon'
import Confetti from 'phosphor-svelte/lib/ConfettiIcon'
import DeviceMobile from 'phosphor-svelte/lib/DeviceMobileIcon'
import DeviceTablet from 'phosphor-svelte/lib/DeviceTabletIcon'
import Disc from 'phosphor-svelte/lib/DiscIcon'
import Fan from 'phosphor-svelte/lib/FanIcon'
import Gear from 'phosphor-svelte/lib/GearIcon'
import HandTap from 'phosphor-svelte/lib/HandTapIcon'
import HandWaving from 'phosphor-svelte/lib/HandWavingIcon'
import Heart from 'phosphor-svelte/lib/HeartIcon'
import House from 'phosphor-svelte/lib/HouseIcon'
import Key from 'phosphor-svelte/lib/KeyIcon'
import Keyboard from 'phosphor-svelte/lib/KeyboardIcon'
import Lightbulb from 'phosphor-svelte/lib/LightbulbIcon'
import Lightning from 'phosphor-svelte/lib/LightningIcon'
import LockOpen from 'phosphor-svelte/lib/LockOpenIcon'
import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlassIcon'
import Megaphone from 'phosphor-svelte/lib/MegaphoneIcon'
import Microphone from 'phosphor-svelte/lib/MicrophoneIcon'
import MicrophoneSlash from 'phosphor-svelte/lib/MicrophoneSlashIcon'
import Moon from 'phosphor-svelte/lib/MoonIcon'
import MusicNotes from 'phosphor-svelte/lib/MusicNotesIcon'
import Pause from 'phosphor-svelte/lib/PauseIcon'
import Play from 'phosphor-svelte/lib/PlayIcon'
import Playlist from 'phosphor-svelte/lib/PlaylistIcon'
import Plug from 'phosphor-svelte/lib/PlugIcon'
import Power from 'phosphor-svelte/lib/PowerIcon'
import Radio from 'phosphor-svelte/lib/RadioIcon'
import Shield from 'phosphor-svelte/lib/ShieldIcon'
import SkipBack from 'phosphor-svelte/lib/SkipBackIcon'
import SkipForward from 'phosphor-svelte/lib/SkipForwardIcon'
import Sparkle from 'phosphor-svelte/lib/SparkleIcon'
import SpeakerHigh from 'phosphor-svelte/lib/SpeakerHighIcon'
import SpeakerLow from 'phosphor-svelte/lib/SpeakerLowIcon'
import SpeakerNone from 'phosphor-svelte/lib/SpeakerNoneIcon'
import Star from 'phosphor-svelte/lib/StarIcon'
import Stop from 'phosphor-svelte/lib/StopIcon'
import SunHorizon from 'phosphor-svelte/lib/SunHorizonIcon'
import Timer from 'phosphor-svelte/lib/TimerIcon'
import User from 'phosphor-svelte/lib/UserIcon'
import Warning from 'phosphor-svelte/lib/WarningIcon'
import X from 'phosphor-svelte/lib/XIcon'

const pair = (lucide, phosphor) => ({ lucide, phosphor })

export const icons = {
  AlarmClock: pair(L.AlarmClock, Alarm),
  Check: pair(L.Check, Check),
  Disc3: pair(L.Disc3, Disc),
  Fan: pair(L.Fan, Fan),
  Gear: pair(L.Settings, Gear),
  Hand: pair(L.Hand, HandWaving), // hello
  Heart: pair(L.Heart, Heart),
  House: pair(L.House, House),
  Key: pair(L.Key, Key),
  Keyboard: pair(L.Keyboard, Keyboard),
  Lightbulb: pair(L.Lightbulb, Lightbulb),
  ListMusic: pair(L.ListMusic, Playlist),
  LockOpen: pair(L.LockOpen, LockOpen),
  Maximize2: pair(L.Maximize2, ArrowsOut),
  Megaphone: pair(L.Megaphone, Megaphone),
  Mic: pair(L.Mic, Microphone),
  MicOff: pair(L.MicOff, MicrophoneSlash),
  Minimize2: pair(L.Minimize2, ArrowsIn),
  Moon: pair(L.Moon, Moon),
  Music: pair(L.Music, MusicNotes),
  PartyPopper: pair(L.PartyPopper, Confetti),
  Pause: pair(L.Pause, Pause),
  Play: pair(L.Play, Play),
  Plug: pair(L.Plug, Plug),
  Power: pair(L.Power, Power),
  Radio: pair(L.Radio, Radio),
  RefreshCw: pair(L.RefreshCw, ArrowsClockwise),
  Search: pair(L.Search, MagnifyingGlass),
  Shield: pair(L.Shield, Shield),
  SkipBack: pair(L.SkipBack, SkipBack),
  SkipForward: pair(L.SkipForward, SkipForward),
  Smartphone: pair(L.Smartphone, DeviceMobile),
  Sparkles: pair(L.Sparkles, Sparkle),
  Square: pair(L.Square, Stop),
  Star: pair(L.Star, Star),
  Sunrise: pair(L.Sunrise, SunHorizon),
  TabletSmartphone: pair(L.TabletSmartphone, DeviceTablet),
  Tap: pair(L.Hand, HandTap), // tap to wake
  Timer: pair(L.Timer, Timer),
  TriangleAlert: pair(L.TriangleAlert, Warning),
  User: pair(L.User, User),
  Volume: pair(L.Volume, SpeakerNone),
  Volume1: pair(L.Volume1, SpeakerLow),
  Volume2: pair(L.Volume2, SpeakerHigh),
  X: pair(L.X, X),
  Zap: pair(L.Zap, Lightning),
}
