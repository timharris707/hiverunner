import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NotificationProvider } from "@/components/notifications/NotificationToast";

function run() {
  const html = renderToStaticMarkup(
    React.createElement(
      NotificationProvider,
      null,
      React.createElement("main", null, "dashboard content"),
    ),
  );

  assert.equal(
    html.includes("position:fixed;bottom:16px;left:16px;z-index:9999"),
    false,
    "NotificationProvider should not render an empty fixed bottom-left toast shell when no toasts exist",
  );

  assert.match(html, /dashboard content/);

  console.log("Notification toast container regression tests passed");
}

run();
