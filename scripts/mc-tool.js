#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`
HiveRunner Agent CLI

Usage:
  mc-tool tasks list                      List open tasks for this company
  mc-tool tasks complete <id> --message <text>  Mark a task as done
  mc-tool agents hire --name <name> --role <role> --model <model>
`);
  process.exit(1);
}

// Infer company from pwd
const pwd = process.cwd();
const match = pwd.match(/\/workspaces\/([^\/]+)/);
if (!match) {
  console.error("Error: mc-tool must be run from inside a company workspace directory.");
  process.exit(1);
}
const companySlug = match[1];
const API_BASE = process.env.MC_API_URL?.replace(/\/$/, "") || "http://localhost:3010/api/orchestration";

function apiHeaders(headers = {}) {
  const resolvedHeaders = { ...headers };
  const apiKey = process.env.MC_API_KEY?.trim();
  if (apiKey) {
    resolvedHeaders["x-mc-api-key"] = apiKey;
  }
  return resolvedHeaders;
}

async function main() {
  const command = args[0];
  const subcommand = args[1];

  if (command === "tasks" && subcommand === "list") {
    const res = await fetch(`${API_BASE}/companies/${companySlug}/inbox?status=open&limit=50`, {
      headers: apiHeaders(),
    });
    if (!res.ok) {
      console.error("Failed to fetch tasks:", await res.text());
      process.exit(1);
    }
    const data = await res.json();
    console.log(`\nActive Tasks for ${companySlug}:\n`);
    if (data.events && data.events.length > 0) {
      for (const event of data.events) {
        if (event.taskSnapshot) {
          const t = event.taskSnapshot;
          console.log(`[${t.id}] ${t.title} (${t.status}) - ${t.priority}`);
          if (t.description) console.log(`  ${t.description}`);
          console.log("");
        }
      }
    } else {
      console.log("No active tasks found.");
    }
  } 
  else if (command === "tasks" && subcommand === "complete") {
    const taskId = args[2];
    const msgIdx = args.indexOf("--message");
    const message = msgIdx !== -1 ? args[msgIdx + 1] : "Completed by agent.";
    
    if (!taskId) {
      console.error("Missing task ID");
      process.exit(1);
    }
    
    const res = await fetch(`${API_BASE}/tasks/reorder`, {
      method: "PATCH",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ taskId, status: "done" })
    });
    
    if (!res.ok) {
      console.error("Failed to complete task:", await res.text());
      process.exit(1);
    }
    
    // optionally post a comment
    await fetch(`${API_BASE}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ content: message })
    });
    
    console.log(`Task ${taskId} marked as done.`);
  }
  else if (command === "agents" && subcommand === "hire") {
    let name, role, model;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--name") name = args[++i];
      if (args[i] === "--role") role = args[++i];
      if (args[i] === "--model") model = args[++i];
    }
    if (!name || !role) {
      console.error("Missing --name or --role");
      process.exit(1);
    }

    const res = await fetch(`${API_BASE}/companies/${companySlug}/agents/hire`, {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, role, model: model || "anthropic/claude-sonnet-4-6" })
    });

    if (!res.ok) {
      console.error("Failed to hire agent:", await res.text());
      process.exit(1);
    }

    const data = await res.json();
    console.log(`Successfully hired agent: ${data.agent.name} (ID: ${data.agent.id})`);
  }
  else {
    console.error(`Unknown command: ${command} ${subcommand}`);
  }
}

main().catch(console.error);
