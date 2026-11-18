"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, ExternalLink, LayoutDashboard } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const PAGES = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/pipeline", label: "Live pipeline", icon: Activity },
  { href: "/explorer", label: "Data explorer", icon: BarChart3 },
] as const;

// Native web UIs of the cluster, published on the host by docker-compose.yml.
const CLUSTER_UIS = [
  { href: "http://localhost:9870", label: "HDFS NameNode" },
  { href: "http://localhost:8088", label: "YARN ResourceManager" },
  { href: "http://localhost:19888", label: "Job history" },
  { href: "http://localhost:10002", label: "HiveServer2" },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 pt-5 pb-3 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-3">
          <div className="grid size-8 shrink-0 grid-cols-2 overflow-hidden rounded-md" aria-hidden>
            <span className="bg-sidebar-primary" />
            <span className="bg-sidebar-foreground/90" />
            <span className="bg-sidebar-foreground/90" />
            <span className="bg-sidebar-primary" />
          </div>
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <p className="font-display text-sm tracking-wide">WEBLOGS</p>
            <p className="eyebrow text-sidebar-foreground/60 !text-[0.6rem]">NASA · 1995</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PAGES.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    isActive={pathname === href}
                    tooltip={label}
                    render={<Link href={href} />}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Cluster UIs</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {CLUSTER_UIS.map(({ href, label }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    tooltip={label}
                    render={<a href={href} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLink />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 pb-4 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
        Flume · Kafka · HDFS · Hive · Sqoop
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
