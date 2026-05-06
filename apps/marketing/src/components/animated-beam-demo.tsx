"use client"

import React, { forwardRef, useRef } from "react"

import { cn } from "../lib/utils"
import { AnimatedBeam } from "./ui/animated-beam"

const Circle = forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode }
>(({ className, children }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "z-10 flex size-12 items-center justify-center rounded-xl border-2 border-slate-300 bg-white p-3 shadow-sm",
        className
      )}
    >
      {children}
    </div>
  )
})

Circle.displayName = "Circle"

export function AnimatedBeamDemo({
  className,
}: {
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const div1Ref = useRef<HTMLDivElement>(null)
  const div2Ref = useRef<HTMLDivElement>(null)
  const div3Ref = useRef<HTMLDivElement>(null)
  const div4Ref = useRef<HTMLDivElement>(null)
  const div5Ref = useRef<HTMLDivElement>(null)
  const div6Ref = useRef<HTMLDivElement>(null)
  const div7Ref = useRef<HTMLDivElement>(null)

  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden p-10",
        className
      )}
      ref={containerRef}
    >
      <div className="flex size-full flex-row items-stretch justify-between gap-10">
        <div className="flex flex-col justify-center gap-6">
          <div className="flex items-center gap-3">
             <Circle ref={div1Ref}>
              <Icons.sentry />
            </Circle>
            <div className="flex flex-col text-xs">
              <span className="font-bold text-slate-800">Sentry</span>
              <span className="text-[10px] text-slate-500 font-mono">OpenAPI</span>
            </div>
          </div>
         
          <div className="flex items-center gap-3">
             <Circle ref={div2Ref}>
              <Icons.github />
            </Circle>
            <div className="flex flex-col text-xs">
              <span className="font-bold text-slate-800">GitHub</span>
              <span className="text-[10px] text-slate-500 font-mono">GraphQL</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
             <Circle ref={div3Ref}>
              <Icons.linear />
            </Circle>
            <div className="flex flex-col text-xs">
              <span className="font-bold text-slate-800">Linear</span>
              <span className="text-[10px] text-slate-500 font-mono">MCP</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col justify-center">
          <Circle ref={div4Ref} className="size-24 rounded-2xl bg-blue-600 text-white border-blue-600 shadow-xl shadow-blue-600/30 flex-col gap-1">
            <Icons.executor />
            <span className="text-xs font-bold mt-1">Executor</span>
          </Circle>
        </div>
        <div className="flex flex-col justify-center gap-6">
          <div className="flex items-center gap-3 flex-row-reverse text-right">
             <Circle ref={div5Ref}>
              <Icons.claude />
            </Circle>
            <div className="flex flex-col text-xs">
              <span className="font-bold text-slate-800">Claude</span>
              <span className="text-[10px] text-slate-500 font-mono">Desktop</span>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-row-reverse text-right">
             <Circle ref={div6Ref}>
              <Icons.cursor />
            </Circle>
            <div className="flex flex-col text-xs">
              <span className="font-bold text-slate-800">Cursor</span>
              <span className="text-[10px] text-slate-500 font-mono">IDE</span>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-row-reverse text-right">
             <Circle ref={div7Ref}>
              <Icons.windsurf />
            </Circle>
            <div className="flex flex-col text-xs">
              <span className="font-bold text-slate-800">Windsurf</span>
              <span className="text-[10px] text-slate-500 font-mono">IDE</span>
            </div>
          </div>
        </div>
      </div>

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={div1Ref}
        toRef={div4Ref}
        curvature={-50}
        pathColor="#cbd5e1"
        gradientStartColor="#3b82f6"
        gradientStopColor="#93c5fd"
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={div2Ref}
        toRef={div4Ref}
        curvature={0}
        pathColor="#cbd5e1"
        gradientStartColor="#3b82f6"
        gradientStopColor="#93c5fd"
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={div3Ref}
        toRef={div4Ref}
        curvature={50}
        pathColor="#cbd5e1"
        gradientStartColor="#3b82f6"
        gradientStopColor="#93c5fd"
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={div4Ref}
        toRef={div5Ref}
        curvature={-50}
        pathColor="#cbd5e1"
        gradientStartColor="#3b82f6"
        gradientStopColor="#93c5fd"
        reverse
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={div4Ref}
        toRef={div6Ref}
        curvature={0}
        pathColor="#cbd5e1"
        gradientStartColor="#3b82f6"
        gradientStopColor="#93c5fd"
        reverse
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={div4Ref}
        toRef={div7Ref}
        curvature={50}
        pathColor="#cbd5e1"
        gradientStartColor="#3b82f6"
        gradientStopColor="#93c5fd"
        reverse
      />
    </div>
  )
}

const Icons = {
  sentry: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full text-[#362D59]"><path d="M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z"/></svg>
  ),
  github: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full text-slate-800"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
  ),
  linear: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full text-[#5E6AD2]"><path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"/></svg>
  ),
  executor: () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-1"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="M10 4v4"></path><path d="M2 8h20"></path><path d="M6 4v4"></path></svg>
  ),
  claude: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full text-[#D97757]"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>
  ),
  cursor: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full text-slate-800"><path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/></svg>
  ),
  windsurf: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full text-[#0B100F]"><path d="M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z"/></svg>
  ),
}
