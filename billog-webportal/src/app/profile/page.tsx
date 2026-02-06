"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const menuItems = [
  {
    section: "บัญชี",
    items: [
      { icon: "👤", label: "แก้ไขโปรไฟล์", href: "/profile/edit" },
      { icon: "👥", label: "กลุ่มของฉัน", href: "/profile/groups" },
      { icon: "🔔", label: "การแจ้งเตือน", href: "/profile/notifications" },
    ],
  },
  {
    section: "ตั้งค่า",
    items: [
      { icon: "💰", label: "งบประมาณ", href: "/profile/budget" },
      { icon: "📊", label: "หมวดหมู่", href: "/profile/categories" },
      { icon: "💳", label: "บัตร/บัญชี", href: "/profile/accounts" },
    ],
  },
  {
    section: "อื่นๆ",
    items: [
      { icon: "📤", label: "ส่งออกข้อมูล", href: "/profile/export" },
      { icon: "❓", label: "ช่วยเหลือ", href: "/profile/help" },
      { icon: "📝", label: "เกี่ยวกับ", href: "/profile/about" },
    ],
  },
];

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="px-4 pt-6 pb-24 space-y-6">
        <div className="text-center py-12 text-[var(--secondary)]">
          กำลังโหลด...
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const handleLogout = () => {
    signOut({ callbackUrl: "/login" });
  };

  return (
    <div className="px-4 pt-6 pb-24 space-y-6">
      {/* Profile Header */}
      <section className="card p-6 flex flex-col items-center">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-[var(--primary)] flex items-center justify-center">
          {session.user?.image ? (
            <img
              src={session.user.image}
              alt={session.user.name || "User"}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-white text-3xl font-bold">
              {session.user?.name?.charAt(0) || "U"}
            </span>
          )}
        </div>
        <h1 className="text-xl font-bold mt-4">{session.user?.name}</h1>
        <p className="text-sm text-[var(--secondary)]">LINE Account</p>
        <div className="flex gap-6 mt-4 pt-4 border-t border-[var(--border)] w-full justify-center">
          <div className="text-center">
            <p className="text-2xl font-bold">฿0</p>
            <p className="text-xs text-[var(--secondary)]">ใช้จ่ายเดือนนี้</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">0</p>
            <p className="text-xs text-[var(--secondary)]">กลุ่ม</p>
          </div>
        </div>
      </section>

      {/* Menu Sections */}
      {menuItems.map((section) => (
        <section key={section.section}>
          <h2 className="text-sm font-medium text-[var(--secondary)] mb-2 px-1">
            {section.section}
          </h2>
          <div className="card divide-y divide-[var(--border)]">
            {section.items.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 p-4 active:bg-[var(--border)]/50 transition-colors"
              >
                <span className="text-xl">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                <svg
                  className="w-5 h-5 text-[var(--secondary)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </a>
            ))}
          </div>
        </section>
      ))}

      {/* Logout Button */}
      <button
        onClick={handleLogout}
        className="w-full card p-4 text-center text-[var(--danger)] font-medium active:bg-[var(--border)]/50 transition-colors"
      >
        ออกจากระบบ
      </button>

      {/* Version */}
      <p className="text-center text-xs text-[var(--secondary)]">
        Billog v1.0.0
      </p>
    </div>
  );
}
