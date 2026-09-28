import { useMemo, useState } from 'react'
import './App.css'

type SalaryEntry = {
  id: string
  employee: string
  department: string
  basePay: number
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function App() {
  const [entries, setEntries] = useState<SalaryEntry[]>([
    {
      id: '1',
      employee: 'Alex Rivera',
      department: 'Operations',
      basePay: 72000,
    },
  ])
  const [employee, setEmployee] = useState('')
  const [department, setDepartment] = useState('')
  const [basePay, setBasePay] = useState('')

  const totalPayroll = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.basePay, 0),
    [entries],
  )

  function handleAddEntry(event: React.FormEvent) {
    event.preventDefault()
    const parsedPay = Number(basePay)
    if (!employee.trim() || !department.trim() || !Number.isFinite(parsedPay) || parsedPay <= 0) {
      return
    }

    setEntries((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        employee: employee.trim(),
        department: department.trim(),
        basePay: parsedPay,
      },
    ])
    setEmployee('')
    setDepartment('')
    setBasePay('')
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">DPCellSalaryWeb</p>
          <h1>Salary overview</h1>
          <p className="subtitle">Track base pay by employee and department.</p>
        </div>
        <div className="summary-card">
          <span>Total payroll</span>
          <strong>{formatCurrency(totalPayroll)}</strong>
          <small>{entries.length} active entries</small>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <h2>Add salary entry</h2>
          <form className="form" onSubmit={handleAddEntry}>
            <label>
              Employee
              <input
                value={employee}
                onChange={(event) => setEmployee(event.target.value)}
                placeholder="Jane Doe"
              />
            </label>
            <label>
              Department
              <input
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                placeholder="Finance"
              />
            </label>
            <label>
              Base pay (USD)
              <input
                type="number"
                min="1"
                step="1000"
                value={basePay}
                onChange={(event) => setBasePay(event.target.value)}
                placeholder="65000"
              />
            </label>
            <button type="submit">Save entry</button>
          </form>
        </section>

        <section className="panel">
          <h2>Current roster</h2>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Base pay</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.employee}</td>
                  <td>{entry.department}</td>
                  <td>{formatCurrency(entry.basePay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  )
}

export default App
