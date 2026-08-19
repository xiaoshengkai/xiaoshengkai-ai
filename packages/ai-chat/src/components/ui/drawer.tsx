"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"
import { cn } from "@/lib/utils/utils"

function DrawerRoot({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerBackdrop({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-backdrop"
      className={cn(
        "fixed inset-0 z-40 bg-black/50 data-[closed]:animate-out data-[closed]:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DrawerPopup({
  className,
  ...props
}: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPortal>
      <DrawerBackdrop />
      <DrawerPrimitive.Popup
        data-slot="drawer-popup"
        className={cn(
          "fixed z-50 bg-background shadow-lg outline-none",
          "data-[closed]:animate-out data-[closed]:slide-out-to-right",
          "data-[open]:animate-in data-[open]:slide-in-from-right",
          className
        )}
        {...props}
      />
    </DrawerPortal>
  )
}

function DrawerHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex items-center justify-between px-4 py-3 border-b", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-sm font-bold text-foreground", className)}
      {...props}
    />
  )
}

function DrawerClose({
  className,
  ...props
}: DrawerPrimitive.Close.Props) {
  return (
    <DrawerPrimitive.Close
      data-slot="drawer-close"
      className={cn(
        "brutal-btn px-2 py-1 text-xs font-bold",
        "bg-card text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DrawerRoot as Root,
  DrawerPortal as Portal,
  DrawerBackdrop as Backdrop,
  DrawerPopup as Popup,
  DrawerHeader as Header,
  DrawerTitle as Title,
  DrawerClose as Close,
}