import { createFileRoute } from "@tanstack/react-router";
import App from "@/gobyy/App";
import "@/gobyy/gobyy.css";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Goby.pics — AI Passport Photos" },
      { name: "description", content: "Create passport-ready photos in your browser with on-device AI. Private, instant, print-ready." },
    ],
  }),
  component: App,
});
