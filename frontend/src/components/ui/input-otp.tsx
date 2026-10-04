import * as React from "react"
import { Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface OTPContextValue {
  value: string
  maxLength: number
  isFocused: boolean
  activeIndex: number
}

const OTPContext = React.createContext<OTPContextValue>({
  value: "",
  maxLength: 6,
  isFocused: false,
  activeIndex: 0,
})

export interface InputOTPProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  maxLength?: number
  value?: string
  onChange?: (value: string) => void
  containerClassName?: string
}

const InputOTP = React.forwardRef<HTMLInputElement, InputOTPProps>(
  ({ className, containerClassName, maxLength = 6, value = "", onChange, disabled, autoFocus, children, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null)
    const [isFocused, setIsFocused] = React.useState(false)

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

    React.useEffect(() => {
      if (autoFocus && !disabled && inputRef.current) {
        const t = setTimeout(() => {
          inputRef.current?.focus()
        }, 50)
        return () => clearTimeout(t)
      }
    }, [autoFocus, disabled])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/\D/g, "").slice(0, maxLength)
      onChange?.(raw)
    }

    const activeIndex = Math.min(value.length, maxLength - 1)

    return (
      <OTPContext.Provider value={{ value, maxLength, isFocused, activeIndex }}>
        <div
          className={cn(
            "relative flex items-center justify-center select-none cursor-text",
            disabled && "opacity-50 cursor-not-allowed",
            containerClassName
          )}
          onClick={() => {
            if (!disabled && inputRef.current) {
              inputRef.current.focus()
            }
          }}
        >
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={maxLength}
            value={value}
            disabled={disabled}
            onChange={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="absolute inset-0 h-full w-full opacity-0 cursor-text z-10 disabled:cursor-not-allowed"
            {...props}
          />
          <div className={cn("flex items-center gap-1.5 sm:gap-2", className)}>
            {children}
          </div>
        </div>
      </OTPContext.Provider>
    )
  }
)
InputOTP.displayName = "InputOTP"

const InputOTPGroup = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center gap-1.5 sm:gap-2", className)} {...props} />
))
InputOTPGroup.displayName = "InputOTPGroup"

const InputOTPSlot = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div"> & { index: number }
>(({ index, className, ...props }, ref) => {
  const { value, isFocused, activeIndex } = React.useContext(OTPContext)
  const char = value[index] ?? ""
  const isActive = isFocused && index === (value.length >= 6 ? 5 : value.length)
  const hasFakeCaret = isActive && !char

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex h-12 w-10 sm:h-14 sm:w-12 items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-xl sm:text-2xl font-bold font-mono text-slate-900 shadow-xs transition-all",
        isActive && "z-1 border-[#003B73] ring-4 ring-[#003B73]/15 scale-105",
        char && "border-slate-300 bg-slate-50/50",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-0.5 animate-caret-blink bg-[#003B73] duration-1000" />
        </div>
      )}
    </div>
  )
})
InputOTPSlot.displayName = "InputOTPSlot"

const InputOTPSeparator = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}>
    <Minus className="h-4 w-4 text-slate-300" />
  </div>
))
InputOTPSeparator.displayName = "InputOTPSeparator"

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
