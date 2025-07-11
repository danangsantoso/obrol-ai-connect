import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const data = [
  { name: "Sen", chats: 45, responses: 42, closing: 12 },
  { name: "Sel", chats: 52, responses: 48, closing: 15 },
  { name: "Rab", chats: 61, responses: 58, closing: 18 },
  { name: "Kam", chats: 48, responses: 45, closing: 14 },
  { name: "Jum", chats: 73, responses: 69, closing: 22 },
  { name: "Sab", chats: 38, responses: 35, closing: 10 },
  { name: "Min", chats: 41, responses: 38, closing: 13 },
];

export function ChatChart() {
  return (
    <div className="bg-card rounded-xl p-6 border border-border shadow-card">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">Performa Chat 7 Hari Terakhir</h3>
        <p className="text-sm text-muted-foreground">Jumlah chat, respons, dan closing harian</p>
      </div>
      
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis 
              dataKey="name" 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px'
              }}
            />
            <Line 
              type="monotone" 
              dataKey="chats" 
              stroke="hsl(var(--primary))" 
              strokeWidth={3}
              dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }}
              name="Total Chat"
            />
            <Line 
              type="monotone" 
              dataKey="responses" 
              stroke="hsl(var(--success))" 
              strokeWidth={3}
              dot={{ fill: 'hsl(var(--success))', strokeWidth: 2, r: 4 }}
              name="Respons"
            />
            <Line 
              type="monotone" 
              dataKey="closing" 
              stroke="hsl(var(--warning))" 
              strokeWidth={3}
              dot={{ fill: 'hsl(var(--warning))', strokeWidth: 2, r: 4 }}
              name="Closing"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div className="flex items-center justify-center space-x-6 mt-4 pt-4 border-t border-border">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-primary"></div>
          <span className="text-sm text-muted-foreground">Total Chat</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-success"></div>
          <span className="text-sm text-muted-foreground">Respons</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-warning"></div>
          <span className="text-sm text-muted-foreground">Closing</span>
        </div>
      </div>
    </div>
  );
}