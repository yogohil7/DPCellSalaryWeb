require("dotenv").config();

(async () => {
  const peek = await fetch("http://localhost:5000/api/employees/next-id").then((r) =>
    r.json()
  );
  console.log("API next-id:", peek);

  const stats = await fetch("http://localhost:5000/api/employees").then((r) =>
    r.json()
  );
  console.log("Employee count:", (stats.data || []).length);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
