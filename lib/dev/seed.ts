// Datos de prueba: puebla toda la app con el día a día de distintos perfiles
// viviendo en Bogotá, para probar pantallas sin crear nada a mano. Solo se
// ejecuta desde la vista de desarrollador.
// Los recurrentes se materializan solos desde enero del año en curso, así
// que no se insertan a mano para no duplicarlos.
import { setUserName, getUserName } from "../storage/settings";
import { addTransaction, setCategoriesForType, addRecurringExpense } from "../storage/finance";
import { addTask, addTaskCategory, toggleTask } from "../storage/tasks";
import { addNote } from "../storage/notes";
import { addGoal, addGoalStep, toggleGoalStep, addPotContribution, markInstallmentById, getGoals } from "../storage/goals";
import { addWishItem } from "../storage/wishlist";
import { Goal } from "../storage/types";
import { clearAllData } from "../storage/helpers";
import { flushMaterializeChain } from "../storage/finance";

// Plantillas disponibles en la vista de desarrollador. Los nombres son solo
// las personas: cada situación de vida queda en la descripción, no en título.
export type DevSeedKind = "parttime" | "supported" | "worker" | "fellowship" | "technical";

function iso(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

// ─── Helpers compartidos ───────────────────────────────────────────────────

async function findGoal(title: string): Promise<Goal | undefined> {
  const goals = await getGoals();
  return goals.find((g) => g.title === title);
}

// Meta de objetivos con pasos en cascada; completa los primeros doneN en orden.
async function seedObjective(
  title: string,
  description: string,
  targetDate: string,
  steps: string[],
  doneN: number
): Promise<void> {
  await addGoal(title, description, targetDate, "objective");
  const goal = await findGoal(title);
  if (!goal) return;
  for (let i = 0; i < steps.length; i += 1) {
    await addGoalStep(goal.id, steps[i], i - 1);
  }
  const fresh = await findGoal(title);
  if (fresh) {
    for (const s of fresh.steps.slice(0, doneN)) {
      await toggleGoalStep(s.id, fresh.id);
    }
  }
}

// Meta de ahorro libre (alcancía): aportes acumulados contra un monto total.
async function seedSavingsPot(
  title: string,
  description: string,
  targetDate: string,
  totalAmount: number,
  contributions: number[]
): Promise<void> {
  await addGoal(title, description, targetDate, "savings", undefined, undefined, totalAmount);
  const goal = await findGoal(title);
  if (!goal) return;
  for (const amount of contributions) {
    await addPotContribution(goal.id, amount);
  }
}

// Meta de pago por cuotas; paga las primeras paidN.
async function seedPayment(
  title: string,
  description: string,
  targetDate: string,
  installments: number,
  totalAmount: number,
  paidN: number
): Promise<void> {
  await addGoal(title, description, targetDate, "payment", installments, "monthly", totalAmount);
  const goal = await findGoal(title);
  if (!goal) return;
  for (const inst of (goal.installmentList ?? []).slice(0, paidN)) {
    await markInstallmentById(inst.id, goal.id);
  }
}

// Alcancía con monto objetivo y aportes ya hechos.
async function seedPotGoal(
  title: string,
  description: string,
  targetDate: string,
  totalAmount: number,
  contributions: number[]
): Promise<void> {
  await addGoal(title, description, targetDate, "pot", undefined, undefined, totalAmount);
  const goal = await findGoal(title);
  if (!goal) return;
  for (const amount of contributions) {
    await addPotContribution(goal.id, amount);
  }
}

// Movimientos puntuales (marzo → agosto del año en curso).
async function seedTransactions(txs: { date: string; type: "income" | "expense"; category: string; description: string; amount: number }[]): Promise<void> {
  for (const tx of txs) {
    await addTransaction(tx);
  }
}

// Recurrentes mensuales con ancla en enero del año en curso.
async function seedRecurring(rec: { description: string; amount: number; category: string; type: "income" | "expense"; day: number }[]): Promise<void> {
  const year = new Date().getFullYear();
  for (const r of rec) {
    await addRecurringExpense({
      type: r.type,
      description: r.description,
      amount: r.amount,
      category: r.category,
      interval: "monthly",
      anchorDate: iso(year, 1, r.day),
    });
  }
}

// ─── Plantilla 1: Andrés — universitario que vive solo y trabaja los fds ───

async function seedPartTime(): Promise<void> {

  await setCategoriesForType("expense", [
    "Arriendo", "Mercado", "Servicios", "Transporte", "Comida", "Estudio",
    "Suscripciones", "Gimnasio", "Salud", "Ropa", "Otros",
  ]);
  await setCategoriesForType("income", [
    "Trabajo", "Freelance", "Ventas", "Reintegros", "Otros ingresos",
  ]);

  await seedRecurring([
    { description: "Pago del fin de semana", amount: 480_000, category: "Trabajo", type: "income", day: 1 },
    { description: "Arriendo del estudio", amount: 620_000, category: "Arriendo", type: "expense", day: 1 },
    { description: "Internet fibra", amount: 59_900, category: "Servicios", type: "expense", day: 8 },
    { description: "Energía y agua", amount: 55_000, category: "Servicios", type: "expense", day: 12 },
    { description: "Plan celular", amount: 35_000, category: "Servicios", type: "expense", day: 5 },
    { description: "Recarga TransMilenio", amount: 140_000, category: "Transporte", type: "expense", day: 10 },
    { description: "Gimnasio del barrio", amount: 89_000, category: "Gimnasio", type: "expense", day: 4 },
    { description: "Spotify", amount: 18_900, category: "Suscripciones", type: "expense", day: 16 },
  ]);

  const year = new Date().getFullYear();
  await seedTransactions([
    // Ingresos extra
    { date: iso(year, 4, 26), type: "income", category: "Freelance", description: "Diseño de logo para emprendimiento", amount: 420_000 },
    { date: iso(year, 6, 7), type: "income", category: "Ventas", description: "Venta de apuntes de cálculo", amount: 150_000 },
    { date: iso(year, 7, 18), type: "income", category: "Freelance", description: "Edición de video para tesis", amount: 350_000 },
    { date: iso(year, 8, 2), type: "income", category: "Reintegros", description: "Reembolso de fotocopias", amount: 28_000 },
    { date: iso(year, 8, 12), type: "income", category: "Ventas", description: "Venta de ropa usada", amount: 120_000 },
    // Marzo
    { date: iso(year, 3, 3), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 210_000 },
    { date: iso(year, 3, 10), type: "expense", category: "Ropa", description: "Jean básico", amount: 99_900 },
    { date: iso(year, 3, 15), type: "expense", category: "Comida", description: "Almuerzo con amigos", amount: 42_000 },
    { date: iso(year, 3, 19), type: "expense", category: "Estudio", description: "Fotocopias e impresiones", amount: 23_500 },
    { date: iso(year, 3, 27), type: "expense", category: "Salud", description: "Farmacia", amount: 38_500 },
    // Abril
    { date: iso(year, 4, 3), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 195_000 },
    { date: iso(year, 4, 9), type: "expense", category: "Estudio", description: "Libro de programación", amount: 98_000 },
    { date: iso(year, 4, 13), type: "expense", category: "Comida", description: "Hamburguesa del barrio", amount: 28_000 },
    { date: iso(year, 4, 20), type: "expense", category: "Ropa", description: "Tenis deportivos", amount: 189_900 },
    { date: iso(year, 4, 30), type: "expense", category: "Otros", description: "Regalo de cumpleaños de mamá", amount: 75_000 },
    // Mayo
    { date: iso(year, 5, 3), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 225_000 },
    { date: iso(year, 5, 12), type: "expense", category: "Comida", description: "Cine y palomitas", amount: 34_000 },
    { date: iso(year, 5, 17), type: "expense", category: "Estudio", description: "Materiales de laboratorio", amount: 48_000 },
    { date: iso(year, 5, 26), type: "expense", category: "Otros", description: "Peluquería", amount: 25_000 },
    // Junio
    { date: iso(year, 6, 3), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 240_000 },
    { date: iso(year, 6, 11), type: "expense", category: "Comida", description: "Almuerzo en la universidad", amount: 25_000 },
    { date: iso(year, 6, 16), type: "expense", category: "Estudio", description: "Inscripción a examen", amount: 65_000 },
    { date: iso(year, 6, 22), type: "expense", category: "Salud", description: "Cita con el odontólogo", amount: 120_000 },
    { date: iso(year, 6, 28), type: "expense", category: "Ropa", description: "Camiseta", amount: 45_000 },
    // Julio
    { date: iso(year, 7, 2), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 215_000 },
    { date: iso(year, 7, 8), type: "expense", category: "Comida", description: "Comida china para llevar", amount: 38_000 },
    { date: iso(year, 7, 15), type: "expense", category: "Estudio", description: "Carpetas y lapiceros", amount: 18_500 },
    { date: iso(year, 7, 20), type: "expense", category: "Otros", description: "Cine con amigos", amount: 39_000 },
    // Agosto
    { date: iso(year, 8, 2), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 230_000 },
    { date: iso(year, 8, 9), type: "expense", category: "Comida", description: "Brunch de domingo", amount: 46_000 },
    { date: iso(year, 8, 13), type: "expense", category: "Estudio", description: "Fotocopias de parciales", amount: 19_500 },
    { date: iso(year, 8, 16), type: "expense", category: "Otros", description: "Lavandería", amount: 18_000 },
  ]);

  await addTaskCategory("Universidad");
  await addTaskCategory("Casa");
  await addTaskCategory("Trabajo");

  for (const [title, priority, category, dueDate] of [
    ["Estudiar para el parcial de programación", "high", "Universidad", iso(year, 8, 20)],
    ["Entregar taller de cálculo", "high", "Universidad", iso(year, 8, 18)],
    ["Turno del sábado en el café", "high", "Trabajo", iso(year, 8, 16)],
    ["Comprar mercado de la semana", "medium", "Casa", iso(year, 8, 16)],
    ["Lavar la ropa", "low", "Casa", iso(year, 8, 16)],
    ["Renovar tarjeta TransMilenio", "medium", "Personal" as const, iso(year, 8, 22)],
    ["Inscribirse a la electiva de inglés", "medium", "Universidad", iso(year, 8, 25)],
  ] as [string, "high" | "medium" | "low", string, string | null][]) {
    await addTask(title, priority, category, dueDate);
  }
  const doneTaskIds = [
    await addTask("Comprar fotocopias de cálculo", "low", "Universidad", null),
    await addTask("Limpiar el apartamento", "low", "Casa", null),
  ];
  for (const id of doneTaskIds) {
    await toggleTask(id);
  }

  await addNote(
    "El límite por sustitución exige que el punto sea de acumulación del dominio. Para polinomios basta evaluar; para raíces multiplicar por el conjugado. Revisar los ejercicios del 3.1 al 3.9.",
    "Apuntes de cálculo — límites"
  );
  await addNote(
    "App para el semillero: rastrear tiempo de estudio con pomodoros y cruzar con las notas de cada materia. MVP: timer + registro por curso. Validar con 3 compañeros antes de construir.",
    "Idea de app para el semillero",
    true
  );
  await addNote("Huevos, arroz, pan, café, queso, arepas, pasta, tomates, aguacate, avena.", "Lista de compras de la semana");
  await addNote("Pagar internet antes del 8 para que no corte el trabajo de los fines de semana.");
  await addNote(
    "El semestre está pesado pero llevo buen ritmo. Meta: no dejar tareas para el fin de semana y descansar el lunes después del turno.",
    "Reflexiones del semestre"
  );

  await seedObjective(
    "Aprobar cálculo integral",
    "El examen final pesa el 40%: priorizar talleres y parciales.",
    iso(year, 11, 30),
    ["Asistir al 80% de las clases", "Hacer todos los talleres", "Pasar el primer parcial", "Pasar el segundo parcial", "Pasar el examen final"],
    3
  );
  await seedSavingsPot(
    "Fondo de emergencia",
    "Tres meses de gastos por si algo sale mal. Apartar de cada pago del fin de semana.",
    iso(year + 1, 8, 1),
    3_000_000,
    [250_000, 200_000, 300_000, 150_000]
  );
  await seedPayment(
    "Pagar la cicla a plazos",
    "Seis cuotas mensuales de 300 mil. Ya pagué la prima.",
    iso(year + 1, 2, 1),
    6,
    1_800_000,
    2
  );
  await seedPotGoal(
    "Vacaciones en San Andrés",
    "Con los compañeros en enero. Apartar cada quincena.",
    iso(year + 1, 1, 15),
    2_400_000,
    [400_000, 350_000, 250_000]
  );

  await addWishItem({
    title: "iPad 10 generación",
    link: "https://www.apple.com/co/ipad/",
    amount: 3_899_000,
    category: "Tecnología",
    description: "Para tomar notas en clase y leer libros sin cargar el portátil.",
  });
  await addWishItem({
    title: "Cascos inalámbricos Sony",
    link: "https://www.sony.com.co/",
    amount: 749_900,
    category: "Tecnología",
    description: "Para estudiar en la biblioteca y en el TransMilenio.",
  });
  await addWishItem({
    title: "Camiseta de la selección",
    link: "https://tienda.adidas.co/",
    amount: 299_900,
    category: "Ropa",
    description: "La versión local para jugar los partidos de los sábados.",
  });
  await addWishItem({
    title: "Mochila para el portátil",
    link: "https://www.mercadolibre.com.co/",
    amount: 185_000,
    category: "Otros",
    description: "Con espacio para el teclado y la botella de agua.",
  });
  await addWishItem({
    title: "Curso de inglés B1",
    link: "https://www.britishcouncil.co/",
    amount: 980_000,
    category: "Estudio",
    description: "Para la electiva y para el trabajo de los fines de semana.",
  });
}

// ─── Plantilla 2: Laura — estudiante con apoyo mensual de sus papás ────────

async function seedSupported(): Promise<void> {

  await setCategoriesForType("expense", [
    "Arriendo", "Mercado", "Universidad", "Servicios", "Transporte", "Comida",
    "Suscripciones", "Gimnasio", "Salud", "Ropa", "Otros",
  ]);
  await setCategoriesForType("income", [
    "Apoyo familiar", "Clases", "Ventas", "Otros ingresos",
  ]);

  await seedRecurring([
    { description: "Apoyo de mis papás", amount: 2_400_000, category: "Apoyo familiar", type: "income", day: 3 },
    { description: "Clases particulares de inglés", amount: 300_000, category: "Clases", type: "income", day: 25 },
    { description: "Arriendo (roomie en Chapinero)", amount: 680_000, category: "Arriendo", type: "expense", day: 1 },
    { description: "Mercado compartido", amount: 450_000, category: "Mercado", type: "expense", day: 5 },
    { description: "Servicios (mitad)", amount: 140_000, category: "Servicios", type: "expense", day: 12 },
    { description: "Plan celular", amount: 79_900, category: "Servicios", type: "expense", day: 8 },
    { description: "Netflix", amount: 47_900, category: "Suscripciones", type: "expense", day: 16 },
    { description: "Crédito educativo ICETEX", amount: 850_000, category: "Universidad", type: "expense", day: 15 },
    { description: "Gimnasio", amount: 120_000, category: "Gimnasio", type: "expense", day: 3 },
  ]);

  const year = new Date().getFullYear();
  await seedTransactions([
    // Ingresos extra
    { date: iso(year, 4, 18), type: "income", category: "Clases", description: "Clase extra de refuerzo", amount: 90_000 },
    { date: iso(year, 6, 10), type: "income", category: "Ventas", description: "Venta de ropa que no me queda", amount: 210_000 },
    { date: iso(year, 8, 5), type: "income", category: "Clases", description: "Clases del mes de vacaciones", amount: 450_000 },
    // Marzo
    { date: iso(year, 3, 7), type: "expense", category: "Universidad", description: "Libros del semestre", amount: 320_000 },
    { date: iso(year, 3, 11), type: "expense", category: "Comida", description: "Brunch con las roomies", amount: 64_000 },
    { date: iso(year, 3, 18), type: "expense", category: "Ropa", description: "Blazer para la pasantía", amount: 210_000 },
    { date: iso(year, 3, 24), type: "expense", category: "Salud", description: "Farmacia", amount: 42_000 },
    // Abril
    { date: iso(year, 4, 6), type: "expense", category: "Universidad", description: "Inscripción a congreso", amount: 120_000 },
    { date: iso(year, 4, 14), type: "expense", category: "Comida", description: "Cena de cumpleaños de mi hermana", amount: 85_000 },
    { date: iso(year, 4, 22), type: "expense", category: "Universidad", description: "Impresiones de la tesis", amount: 38_000 },
    { date: iso(year, 4, 28), type: "expense", category: "Otros", description: "Café con la asesora", amount: 22_000 },
    // Mayo
    { date: iso(year, 5, 10), type: "expense", category: "Universidad", description: "Cuota de la banda", amount: 45_000 },
    { date: iso(year, 5, 17), type: "expense", category: "Ropa", description: "Zapatos para la salsoteca", amount: 168_000 },
    { date: iso(year, 5, 23), type: "expense", category: "Comida", description: "Plan de sushi con amigas", amount: 72_000 },
    { date: iso(year, 5, 30), type: "expense", category: "Otros", description: "Entradas al planetario", amount: 30_000 },
    // Junio
    { date: iso(year, 6, 8), type: "expense", category: "Universidad", description: "Matrícula segundo semestre", amount: 3_800_000 },
    { date: iso(year, 6, 13), type: "expense", category: "Comida", description: "Restaurante con la familia", amount: 120_000 },
    { date: iso(year, 6, 20), type: "expense", category: "Ropa", description: "Pijama y zapatillas", amount: 140_000 },
    { date: iso(year, 6, 27), type: "expense", category: "Otros", description: "Regalo para mi hermanita", amount: 95_000 },
    // Julio
    { date: iso(year, 7, 4), type: "expense", category: "Universidad", description: "Memoria USB + adaptador", amount: 65_000 },
    { date: iso(year, 7, 12), type: "expense", category: "Comida", description: "Picnic en Simón Bolívar", amount: 54_000 },
    { date: iso(year, 7, 21), type: "expense", category: "Salud", description: "Cita odontológica", amount: 95_000 },
    { date: iso(year, 7, 29), type: "expense", category: "Otros", description: "Lavandería del mes", amount: 24_000 },
    // Agosto
    { date: iso(year, 8, 8), type: "expense", category: "Universidad", description: "Carpetas y separadores", amount: 28_500 },
    { date: iso(year, 8, 11), type: "expense", category: "Comida", description: "Almuerzo de la residencia", amount: 30_000 },
    { date: iso(year, 8, 15), type: "expense", category: "Otros", description: "Transporte a la casa de mis papás", amount: 18_000 },
  ]);

  await addTaskCategory("Universidad");
  await addTaskCategory("Casa");
  await addTaskCategory("Personal");

  for (const [title, priority, category, dueDate] of [
    ["Entregar avance de la tesis", "high", "Universidad", iso(year, 8, 17)],
    ["Reunión con la asesora", "high", "Universidad", iso(year, 8, 14)],
    ["Pagar cuota del ICETEX", "high", "Personal", iso(year, 8, 15)],
    ["Comprar mercado con la roomie", "medium", "Casa", iso(year, 8, 16)],
    ["Visitar a mis papás", "medium", "Personal", iso(year, 8, 23)],
    ["Sacar cita de odontología", "low", "Personal", iso(year, 8, 28)],
  ] as [string, "high" | "medium" | "low", string, string | null][]) {
    await addTask(title, priority, category, dueDate);
  }
  const doneSupportedTasks = [
    await addTask("Enviar el formato de matrícula", "low", "Universidad", null),
    await addTask("Lavar y organizar el closet", "low", "Casa", null),
  ];
  for (const id of doneSupportedTasks) {
    await toggleTask(id);
  }

  await addNote(
    "Presupuesto del mes: del apoyo de papás salen ICETEX, arriendo y mercado. Lo que gane con clases se va al ahorro de la pasantía.",
    "Presupuesto mensual",
    true
  );
  await addNote(
    "Capítulos 4 y 5 de la tesis: aplicar el método de análisis de contenido a las entrevistas. Transcribir las de marzo antes del 20.",
    "Avance de tesis"
  );
  await addNote("Jueves: clases particulares — repasar present simple, past continuous y phrasal verbs del capítulo 6.");
  await addNote("Cotizar el cambio de la pantalla del portátil: en la calle del comercio piden 380.000, revisar la tienda oficial.");

  await seedObjective(
    "Terminar la tesis de pregrado",
    "Último semestre: priorizar la tesis y la pasantía sobre lo demás.",
    iso(year, 11, 10),
    ["Aplicar el método al trabajo de campo", "Entregar el primer borrador", "Corregir con la asesora", "Sustentar ante el jurado"],
    2
  );
  await seedSavingsPot(
    "Ahorro para la pasantía",
    "La pasantía en Cali no paga hospedaje: cubrir vuelo y estadía.",
    iso(year + 1, 3, 1),
    2_800_000,
    [250_000, 300_000, 180_000]
  );
  await seedPayment(
    "Portátil nuevo a crédito",
    "Doce cuotas con el ICETEX; la garantía cubre dos años.",
    iso(year + 1, 9, 1),
    12,
    4_600_000,
    5
  );
  await seedPotGoal(
    "Viaje de grado a Cartagena",
    "El grupo de la carrera: tres noches en Bocagrande.",
    iso(year + 1, 5, 30),
    3_500_000,
    [400_000, 350_000, 300_000]
  );

  await addWishItem({
    title: "MacBook Air M2",
    link: "https://www.apple.com/co/macbook-air/",
    amount: 6_999_000,
    category: "Tecnología",
    description: "Para la tesis, la pasantía y las clases particulares.",
  });
  await addWishItem({
    title: "Bicicleta urbana",
    link: "https://www.mercadolibre.com.co/",
    amount: 1_850_000,
    category: "Transporte",
    description: "Para llegar a la universidad sin depender del TransMilenio.",
  });
  await addWishItem({
    title: "Tenacitas de viaje",
    link: "https://www.falabella.com.co/",
    amount: 320_000,
    category: "Otros",
    description: "Para el viaje de grado y la pasantía.",
  });
  await addWishItem({
    title: "Set de skincare",
    link: "https://www.d1.com.co/",
    amount: 240_000,
    category: "Salud",
    description: "Rutina para la piel después de los meses de tesis.",
  });
  await addWishItem({
    title: "Curso de excel avanzado",
    link: "https://www.utel.edu.co/",
    amount: 350_000,
    category: "Universidad",
    description: "Para la pasantía de análisis de datos.",
  });
}

// ─── Plantilla 3: Daniel — trabajador asalariado soltero ───────────────────

async function seedWorker(): Promise<void> {

  await setCategoriesForType("expense", [
    "Vivienda", "Mercado", "Servicios", "Transporte", "Comida", "Salud",
    "Gimnasio", "Suscripciones", "Ropa", "Entretenimiento", "Otros",
  ]);
  await setCategoriesForType("income", [
    "Salario", "Primas", "Bonos", "Ventas", "Otros ingresos",
  ]);

  await seedRecurring([
    { description: "Salario mensual", amount: 3_100_000, category: "Salario", type: "income", day: 15 },
    { description: "Arriendo del apartamento", amount: 950_000, category: "Vivienda", type: "expense", day: 1 },
    { description: "Administración del conjunto", amount: 160_000, category: "Vivienda", type: "expense", day: 1 },
    { description: "Mercado", amount: 520_000, category: "Mercado", type: "expense", day: 6 },
    { description: "Energía", amount: 140_000, category: "Servicios", type: "expense", day: 12 },
    { description: "Internet fibra", amount: 92_000, category: "Servicios", type: "expense", day: 12 },
    { description: "Agua", amount: 45_000, category: "Servicios", type: "expense", day: 12 },
    { description: "Plan celular", amount: 59_900, category: "Servicios", type: "expense", day: 8 },
    { description: "Parqueadero del conjunto", amount: 130_000, category: "Transporte", type: "expense", day: 10 },
    { description: "Gimnasio", amount: 115_000, category: "Gimnasio", type: "expense", day: 3 },
    { description: "Spotify y YouTube", amount: 42_900, category: "Suscripciones", type: "expense", day: 16 },
  ]);

  const year = new Date().getFullYear();
  await seedTransactions([
    // Ingresos extra
    { date: iso(year, 6, 30), type: "income", category: "Primas", description: "Prima de mitad de año", amount: 1_940_000 },
    { date: iso(year, 7, 12), type: "income", category: "Bonos", description: "Bono por cumplimiento", amount: 350_000 },
    { date: iso(year, 8, 1), type: "income", category: "Ventas", description: "Venta del escritorio viejo", amount: 220_000 },
    // Mercado extra y despensa
    { date: iso(year, 3, 13), type: "expense", category: "Mercado", description: "Despensa de la quincena", amount: 210_000 },
    { date: iso(year, 4, 10), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 240_000 },
    { date: iso(year, 5, 8), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 195_000 },
    { date: iso(year, 6, 12), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 260_000 },
    { date: iso(year, 7, 10), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 215_000 },
    { date: iso(year, 8, 14), type: "expense", category: "Mercado", description: "Mercado de la quincena", amount: 230_000 },
    // Carro y moto
    { date: iso(year, 3, 9), type: "expense", category: "Transporte", description: "Gasolina", amount: 190_000 },
    { date: iso(year, 4, 6), type: "expense", category: "Transporte", description: "Gasolina", amount: 175_000 },
    { date: iso(year, 5, 3), type: "expense", category: "Transporte", description: "Gasolina", amount: 185_000 },
    { date: iso(year, 5, 21), type: "expense", category: "Transporte", description: "Cambio de aceite", amount: 180_000 },
    { date: iso(year, 6, 7), type: "expense", category: "Transporte", description: "Gasolina", amount: 200_000 },
    { date: iso(year, 7, 5), type: "expense", category: "Transporte", description: "Gasolina", amount: 170_000 },
    { date: iso(year, 8, 2), type: "expense", category: "Transporte", description: "Lavado y pulida", amount: 60_000 },
    { date: iso(year, 8, 16), type: "expense", category: "Transporte", description: "Gasolina", amount: 185_000 },
    // Salud
    { date: iso(year, 3, 17), type: "expense", category: "Salud", description: "Copagos del mes", amount: 42_000 },
    { date: iso(year, 5, 14), type: "expense", category: "Salud", description: "Odontología", amount: 160_000 },
    { date: iso(year, 6, 18), type: "expense", category: "Salud", description: "Farmacia", amount: 55_000 },
    { date: iso(year, 8, 7), type: "expense", category: "Salud", description: "Exámenes de laboratorio", amount: 78_000 },
    // Entretenimiento, comida y hogar
    { date: iso(year, 3, 23), type: "expense", category: "Entretenimiento", description: "Cine con amigos", amount: 68_000 },
    { date: iso(year, 4, 19), type: "expense", category: "Comida", description: "Asado en casa de un amigo", amount: 90_000 },
    { date: iso(year, 5, 25), type: "expense", category: "Entretenimiento", description: "Partido en el estadio", amount: 120_000 },
    { date: iso(year, 6, 21), type: "expense", category: "Comida", description: "Restaurante de la 85", amount: 135_000 },
    { date: iso(year, 7, 18), type: "expense", category: "Ropa", description: "Zapatos para el trabajo", amount: 210_000 },
    { date: iso(year, 8, 9), type: "expense", category: "Entretenimiento", description: "Plan de juegos con amigos", amount: 85_000 },
    { date: iso(year, 4, 27), type: "expense", category: "Otros", description: "Regalo de cumpleaños de mi sobrino", amount: 100_000 },
    { date: iso(year, 7, 26), type: "expense", category: "Otros", description: "Buen servicio de almuerzos", amount: 60_000 },
  ]);

  await addTaskCategory("Trabajo");
  await addTaskCategory("Casa");
  await addTaskCategory("Personal");

  for (const [title, priority, category, dueDate] of [
    ["Presentar informe de cierre de mes", "high", "Trabajo", iso(year, 8, 18)],
    ["Pagar arriendo y administración", "high", "Casa", iso(year, 8, 1)],
    ["SOAT y revisión técnico-mecánica", "medium", "Personal", iso(year, 8, 22)],
    ["Comprar mercado de la semana", "medium", "Casa", iso(year, 8, 16)],
    ["Trámite del pasaporte", "low", "Personal", iso(year, 8, 26)],
    ["Vacunar al perro", "medium", "Personal", iso(year, 8, 20)],
    ["Fumigar el apartamento", "low", "Casa", iso(year, 8, 28)],
  ] as [string, "high" | "medium" | "low", string, string | null][]) {
    await addTask(title, priority, category, dueDate);
  }
  const doneWorkerTasks = [
    await addTask("Cambiar el aceite del carro", "medium", "Personal", null),
    await addTask("Pagar la factura de la luz", "low", "Casa", null),
  ];
  for (const id of doneWorkerTasks) {
    await toggleTask(id);
  }

  await addNote(
    "Presupuesto del mes: arriendo, servicios y mercado cubren lo fijo; el resto del salario se reparte 40% ahorro, 30% carro y 30% libre.",
    "Presupuesto mensual",
    true
  );
  await addNote(
    "Lunes: pechuga + arroz; Martes: sopa de verduras; Miércoles: pasta boloñesa; Jueves: pescado; Viernes: pizza casera. Variar las salsas de la semana.",
    "Menú de la semana"
  );
  await addNote("Cambiar el aceite antes del viaje a Melgar. Llevar la llanta de repuesto bien inflada y el botiquín al día.");
  await addNote("Pendiente: cotizar baño de alfombra en la 80 (dos lavaderos piden 90.000 y 110.000).");

  await seedObjective(
    "Comprar el carro propio",
    "Ahorrar la cuota inicial de un usado confiable y sacar el crédito con bancolombia.",
    iso(year + 1, 6, 1),
    ["Ahorrar la cuota inicial (15%)", "Comparar créditos de 3 bancos", "Probar 5 vehículos usados", "Cerrar el negocio con el vendedor"],
    1
  );
  await seedSavingsPot(
    "Fondo de emergencia",
    "Cuatro meses de arriendo y mercado por si algo sale mal.",
    iso(year + 1, 9, 1),
    6_000_000,
    [400_000, 350_000, 450_000, 300_000]
  );
  await seedPayment(
    "Nevera nueva a cuotas",
    "La actual tiene 12 años: 10 cuotas sin interés con la tarjeta.",
    iso(year + 1, 5, 1),
    10,
    3_400_000,
    2
  );
  await seedPotGoal(
    "Vacaciones en Santa Marta",
    "Semana santa con mi novia y el perro.",
    iso(year + 1, 3, 20),
    4_500_000,
    [500_000, 400_000, 350_000]
  );

  await addWishItem({
    title: "Dron DJI Mini 3",
    link: "https://www.dji.com/co",
    amount: 2_899_000,
    category: "Tecnología",
    description: "Para grabar los viajes de la novia y los paseos con el perro.",
  });
  await addWishItem({
    title: "TV 55\" OLED",
    link: "https://www.lg.com/co/",
    amount: 3_700_000,
    category: "Hogar",
    description: "Para el apartamento nuevo.",
  });
  await addWishItem({
    title: "Cafetera expreso",
    link: "https://www.nespresso.com/co/",
    amount: 1_350_000,
    category: "Hogar",
    description: "Para los desayunos de fin de semana.",
  });
  await addWishItem({
    title: "Reloj inteligente",
    link: "https://www.samsung.com/co/",
    amount: 1_100_000,
    category: "Tecnología",
    description: "Para medir las salidas a trotar por la mañana.",
  });
  await addWishItem({
    title: "Juego de maletas",
    link: "https://www.falabella.com.co/",
    amount: 720_000,
    category: "Viajes",
    description: "Para Santa Marta y los viajes del año.",
  });
}

// ─── Plantilla 4: Camila — maestría con beca y docencia ────────────────────

async function seedFellowship(): Promise<void> {

  await setCategoriesForType("expense", [
    "Arriendo", "Mercado", "Educación", "Servicios", "Transporte", "Comida",
    "Café", "Gimnasio", "Salud", "Ropa", "Otros",
  ]);
  await setCategoriesForType("income", [
    "Beca", "Docencia", "Investigación", "Reintegros", "Otros ingresos",
  ]);

  await seedRecurring([
    { description: "Sostén de la beca de maestría", amount: 1_500_000, category: "Beca", type: "income", day: 1 },
    { description: "Asistente de docencia", amount: 450_000, category: "Docencia", type: "income", day: 10 },
    { description: "Arriendo del apartaestudio", amount: 1_050_000, category: "Arriendo", type: "expense", day: 5 },
    { description: "Servicios públicos", amount: 130_000, category: "Servicios", type: "expense", day: 14 },
    { description: "Internet fibra", amount: 73_000, category: "Servicios", type: "expense", day: 14 },
    { description: "Plan celular", amount: 49_900, category: "Servicios", type: "expense", day: 8 },
    { description: "Mercado pequeño", amount: 380_000, category: "Mercado", type: "expense", day: 6 },
    { description: "Overleaf y Notion", amount: 25_000, category: "Educación", type: "expense", day: 20 },
    { description: "Café de la zona G", amount: 85_000, category: "Café", type: "expense", day: 15 },
    { description: "Gimnasio boutique", amount: 150_000, category: "Gimnasio", type: "expense", day: 3 },
  ]);

  const year = new Date().getFullYear();
  await seedTransactions([
    // Ingresos extra
    { date: iso(year, 4, 28), type: "income", category: "Investigación", description: "Pago por codificación de entrevistas", amount: 600_000 },
    { date: iso(year, 6, 22), type: "income", category: "Reintegros", description: "Reembolso del congreso", amount: 480_000 },
    { date: iso(year, 7, 12), type: "income", category: "Investigación", description: "Colaboración en paper del grupo", amount: 800_000 },
    // Marzo
    { date: iso(year, 3, 13), type: "expense", category: "Educación", description: "Cursos de métodos cuantitativos", amount: 250_000 },
    { date: iso(year, 3, 19), type: "expense", category: "Comida", description: "Almuerzo con el semillero", amount: 38_000 },
    { date: iso(year, 3, 25), type: "expense", category: "Ropa", description: "Camisas para docencia", amount: 180_000 },
    { date: iso(year, 3, 29), type: "expense", category: "Otros", description: "Entradas al museo", amount: 28_000 },
    // Abril
    { date: iso(year, 4, 9), type: "expense", category: "Educación", description: "Libros importados", amount: 320_000 },
    { date: iso(year, 4, 16), type: "expense", category: "Transporte", description: "Vuelo a congreso en Cali", amount: 420_000 },
    { date: iso(year, 4, 19), type: "expense", category: "Comida", description: "Cena de networking", amount: 90_000 },
    { date: iso(year, 4, 25), type: "expense", category: "Salud", description: "Terapia (4 sesiones)", amount: 150_000 },
    // Mayo
    { date: iso(year, 5, 6), type: "expense", category: "Comida", description: "Almuerzo de campo en Cota", amount: 45_000 },
    { date: iso(year, 5, 15), type: "expense", category: "Educación", description: "Inscripciones de la revista", amount: 60_000 },
    { date: iso(year, 5, 22), type: "expense", category: "Ropa", description: "Zapatos cómodos para caminar", amount: 190_000 },
    { date: iso(year, 5, 28), type: "expense", category: "Otros", description: "Impresión del póster", amount: 35_000 },
    // Junio
    { date: iso(year, 6, 7), type: "expense", category: "Educación", description: "Taller de análisis con R", amount: 180_000 },
    { date: iso(year, 6, 13), type: "expense", category: "Comida", description: "Brunch con el director de tesis", amount: 55_000 },
    { date: iso(year, 6, 19), type: "expense", category: "Salud", description: "Vitamina y suplementos", amount: 85_000 },
    { date: iso(year, 6, 26), type: "expense", category: "Otros", description: "Mercado de arte de Usaquén", amount: 42_000 },
    // Julio
    { date: iso(year, 7, 9), type: "expense", category: "Educación", description: "Suscripción anual a repositorio", amount: 140_000 },
    { date: iso(year, 7, 17), type: "expense", category: "Transporte", description: "Taxi a la universidad", amount: 42_000 },
    { date: iso(year, 7, 23), type: "expense", category: "Comida", description: "Cena de cumpleaños", amount: 110_000 },
    { date: iso(year, 7, 30), type: "expense", category: "Otros", description: "Lavandería", amount: 26_000 },
    // Agosto
    { date: iso(year, 8, 5), type: "expense", category: "Educación", description: "Cuadernos de campo", amount: 48_000 },
    { date: iso(year, 8, 12), type: "expense", category: "Comida", description: "Café de estudio con colegas", amount: 32_000 },
    { date: iso(year, 8, 15), type: "expense", category: "Otros", description: "Regalo para la coordinadora", amount: 60_000 },
  ]);

  await addTaskCategory("Maestría");
  await addTaskCategory("Investigación");
  await addTaskCategory("Personal");

  for (const [title, priority, category, dueDate] of [
    ["Corregir el capítulo 2 de la tesis", "high", "Maestría", iso(year, 8, 19)],
    ["Preparar clase del jueves", "high", "Maestría", iso(year, 8, 13)],
    ["Transcribir entrevistas del grupo de Cota", "medium", "Investigación", iso(year, 8, 22)],
    ["Enviar resumen al congreso de Medellín", "medium", "Investigación", iso(year, 8, 25)],
    ["Comprar mercado", "low", "Personal", iso(year, 8, 16)],
    ["Vacunación de refuerzo", "low", "Personal", iso(year, 8, 28)],
  ] as [string, "high" | "medium" | "low", string, string | null][]) {
    await addTask(title, priority, category, dueDate);
  }
  const doneFellowshipTasks = [
    await addTask("Subir las encuestas a la carpeta compartida", "low", "Investigación", null),
    await addTask("Pagar matrícula de la maestría", "high", "Maestría", null),
  ];
  for (const id of doneFellowshipTasks) {
    await toggleTask(id);
  }

  await addNote(
    "Paper del grupo: primeros resultados de la encuesta de movilidad. El gran grupo quiere el draft para el 12 de septiembre con visualizaciones en R.",
    "Estado del paper",
    true
  );
  await addNote(
    "Plan de clase del jueves: método de caso + taller de lectura crítica. Llevar la guía impresa y el material del LMS.",
    "Clase de métodos"
  );
  await addNote("Comprar los capítulos de la Routledge antes del 25: el precio en físico es el doble que el digital.");
  await addNote("Estancia en Toronto: llenar la solicitud de visa antes de octubre y pedir la carta a la universidad.");

  await seedObjective(
    "Someter dos artículos a revistas indexadas",
    "El grado necesita al menos una publicación aceptada.",
    iso(year + 1, 4, 1),
    ["Cerrar el primer paper con el grupo", "Elegir las 3 revistas objetivo", "Someter el primer artículo", "Atender la ronda de revisores", "Someter el segundo artículo"],
    2
  );
  await seedSavingsPot(
    "Fondo para estancia en el exterior",
    "Cuatro meses de estancia de investigación en Toronto.",
    iso(year + 1, 8, 1),
    10_000_000,
    [500_000, 450_000, 600_000, 400_000]
  );
  await seedPayment(
    "Audífonos de estudio en cuotas",
    "Cuatro cuotas con la tienda; cancelé la primera.",
    iso(year + 1, 2, 1),
    4,
    1_450_000,
    2
  );
  await seedPotGoal(
    "Congreso internacional 2027",
    "Presentar los avances de la tesis en el encuentro de la región.",
    iso(year + 1, 6, 15),
    6_500_000,
    [700_000, 600_000, 500_000]
  );

  await addWishItem({
    title: "MacBook Pro 14\"",
    link: "https://www.apple.com/co/macbook-pro/",
    amount: 8_999_000,
    category: "Tecnología",
    description: "Para correr los análisis en R y escribir la tesis sin cierres.",
  });
  await addWishItem({
    title: "Kindle Paperwhite",
    link: "https://www.amazon.com/",
    amount: 850_000,
    category: "Tecnología",
    description: "Para leer las 30 referencias del marco teórico.",
  });
  await addWishItem({
    title: "Sándwich de cuero vegano",
    link: "https://www.falabella.com.co/",
    amount: 310_000,
    category: "Ropa",
    description: "Para docencia y presentaciones del semillero.",
  });
  await addWishItem({
    title: "Monitor 27\" para leer papers",
    link: "https://www.samsung.com/co/",
    amount: 950_000,
    category: "Tecnología",
    description: "Dos artículos lado a lado sin cambiar de pestaña.",
  });
  await addWishItem({
    title: "Membresía de la biblioteca nacional",
    link: "https://www.bibliotecanacional.gov.co/",
    amount: 120_000,
    category: "Educación",
    description: "Salas silenciosas para las jornadas largas de escritura.",
  });
}

// ─── Plantilla 5: Sebastián — técnico con prácticas y emprendimiento ───────

async function seedTechnical(): Promise<void> {

  await setCategoriesForType("expense", [
    "Aporte en casa", "Mercado", "Servicios", "Transporte", "Comida", "Estudio",
    "Moto", "Gimnasio", "Salud", "Ropa", "Otros",
  ]);
  await setCategoriesForType("income", [
    "Prácticas", "Ventas", "Encargos", "Otros ingresos",
  ]);

  await seedRecurring([
    { description: "Prácticas académicas", amount: 900_000, category: "Prácticas", type: "income", day: 20 },
    { description: "Venta de diseños y stickers", amount: 80_000, category: "Ventas", type: "income", day: 25 },
    { description: "Aporte de mercado en casa", amount: 250_000, category: "Aporte en casa", type: "expense", day: 5 },
    { description: "Servicios (mitad)", amount: 90_000, category: "Servicios", type: "expense", day: 12 },
    { description: "TransMilenio mensual", amount: 140_000, category: "Transporte", type: "expense", day: 10 },
    { description: "Plan celular", amount: 50_000, category: "Servicios", type: "expense", day: 8 },
    { description: "Cuota de la moto (a mi papá)", amount: 280_000, category: "Moto", type: "expense", day: 15 },
    { description: "Gimnasio del barrio", amount: 79_000, category: "Gimnasio", type: "expense", day: 3 },
  ]);

  const year = new Date().getFullYear();
  await seedTransactions([
    // Ingresos extra
    { date: iso(year, 4, 12), type: "income", category: "Encargos", description: "Bordados personalizados", amount: 140_000 },
    { date: iso(year, 5, 19), type: "income", category: "Ventas", description: "Feria de emprendimiento", amount: 320_000 },
    { date: iso(year, 7, 9), type: "income", category: "Encargos", description: "Diseño del logo del salón", amount: 260_000 },
    { date: iso(year, 8, 14), type: "income", category: "Ventas", description: "Pedido de stickers para evento", amount: 180_000 },
    // Marzo
    { date: iso(year, 3, 7), type: "expense", category: "Estudio", description: "Libro de redes de datos", amount: 110_000 },
    { date: iso(year, 3, 14), type: "expense", category: "Comida", description: "Salida con los del SENA", amount: 35_000 },
    { date: iso(year, 3, 21), type: "expense", category: "Ropa", description: "Overol para la práctica", amount: 95_000 },
    { date: iso(year, 3, 28), type: "expense", category: "Otros", description: "Cortada y pintada", amount: 25_000 },
    // Abril
    { date: iso(year, 4, 8), type: "expense", category: "Estudio", description: "Cable de red y conectores", amount: 48_000 },
    { date: iso(year, 4, 17), type: "expense", category: "Moto", description: "Guantes de moto", amount: 90_000 },
    { date: iso(year, 4, 26), type: "expense", category: "Comida", description: "Pizza con los primos", amount: 42_000 },
    // Mayo
    { date: iso(year, 5, 7), type: "expense", category: "Moto", description: "Tanque de la moto", amount: 60_000 },
    { date: iso(year, 5, 14), type: "expense", category: "Estudio", description: "Material del módulo de sistemas", amount: 38_000 },
    { date: iso(year, 5, 23), type: "expense", category: "Salud", description: "Farmacia", amount: 32_000 },
    { date: iso(year, 5, 29), type: "expense", category: "Ropa", description: "Jeans", amount: 120_000 },
    // Junio
    { date: iso(year, 6, 6), type: "expense", category: "Moto", description: "Mantenimiento de la moto", amount: 140_000 },
    { date: iso(year, 6, 13), type: "expense", category: "Comida", description: "Hamburguesa con los del grupo", amount: 33_000 },
    { date: iso(year, 6, 20), type: "expense", category: "Otros", description: "Stands para la feria", amount: 70_000 },
    { date: iso(year, 6, 27), type: "expense", category: "Estudio", description: "Suscripción al curso de nube", amount: 80_000 },
    // Julio
    { date: iso(year, 7, 4), type: "expense", category: "Moto", description: "Tanque de la moto", amount: 55_000 },
    { date: iso(year, 7, 17), type: "expense", category: "Comida", description: "Plan con mi novia", amount: 65_000 },
    { date: iso(year, 7, 24), type: "expense", category: "Ropa", description: "Chaqueta de jean", amount: 110_000 },
    { date: iso(year, 7, 31), type: "expense", category: "Otros", description: "Entradas al cine", amount: 36_000 },
    // Agosto
    { date: iso(year, 8, 8), type: "expense", category: "Moto", description: "Rodamiento del manubrio", amount: 85_000 },
    { date: iso(year, 8, 11), type: "expense", category: "Comida", description: "Almuerzo en la sede", amount: 28_000 },
    { date: iso(year, 8, 15), type: "expense", category: "Estudio", description: "Carpetas del grado", amount: 22_000 },
  ]);

  await addTaskCategory("Estudio");
  await addTaskCategory("Casa");
  await addTaskCategory("Moto");

  for (const [title, priority, category, dueDate] of [
    ["Terminar el proyecto final de redes", "high", "Estudio", iso(year, 8, 18)],
    ["Pasar el informe de prácticas", "high", "Estudio", iso(year, 8, 21)],
    ["Cambiarle la cadena a la moto", "medium", "Moto", iso(year, 8, 24)],
    ["Cuota de la moto (día 15)", "high", "Moto", iso(year, 8, 15)],
    ["Preparar la feria de emprendimiento", "medium", "Estudio", iso(year, 8, 30)],
    ["Colaborar con el mercado de la casa", "medium", "Casa", iso(year, 8, 16)],
  ] as [string, "high" | "medium" | "low", string, string | null][]) {
    await addTask(title, priority, category, dueDate);
  }
  const doneTechTasks = [
    await addTask("Lavar la moto", "low", "Moto", null),
    await addTask("Organizar los apuntes del módulo", "low", "Estudio", null),
  ];
  for (const id of doneTechTasks) {
    await toggleTask(id);
  }

  await addNote(
    "Proyecto final de redes: montar una mini red de 3 nodos con switch y router. Diagrama en Packet Tracer y prueba en físico con los cables que compré.",
    "Proyecto de redes",
    true
  );
  await addNote(
    "Idea de negocio: stickers y diseños personalizados para empresas del barrio. Los estándares más vendidos fueron logos de peluquerías y montallantas. Subir precios un 10%.",
    "Emprendimiento de diseño"
  );
  await addNote("Presupuesto del mes: prácticas 900k + ventas ~80k; aporte en casa y cuota de la moto salen primero, el resto al ahorro del viaje.");
  await addNote("Revisar el kit de herramientas de la práctica: llave 10-11, destornillador plano y de estrella, y probe del router.");

  await seedObjective(
    "Graduarme como técnico en sistemas",
    "Último año: el proyecto final y las prácticas definen el título.",
    iso(year, 11, 15),
    ["Terminar el proyecto de redes", "Aprobar todas las materias", "Completar las 384 horas de práctica", "Presentar la sustentación final"],
    2
  );
  await seedSavingsPot(
    "Ahorro para la moto",
    "Apartar de cada práctica: la moto queda mía al terminar de pagar la cuota.",
    iso(year + 1, 6, 1),
    4_500_000,
    [300_000, 250_000, 350_000, 200_000]
  );
  await seedPayment(
    "Cuotas de la impresora 3D",
    "Para el emprendimiento de stickers y llaveros personalizados.",
    iso(year + 1, 3, 1),
    6,
    2_400_000,
    2
  );
  await seedPotGoal(
    "Viaje a Santa Marta",
    "Después de graduarme: semana de playa con los del SENA.",
    iso(year + 1, 1, 10),
    2_800_000,
    [300_000, 250_000, 200_000]
  );

  await addWishItem({
    title: "Casco para moto",
    link: "https://www.mercadolibre.com.co/",
    amount: 380_000,
    category: "Moto",
    description: "Certificado, para los trayectos largos a la sede.",
  });
  await addWishItem({
    title: "Chaqueta de moto con protecciones",
    link: "https://www.falabella.com.co/",
    amount: 650_000,
    category: "Moto",
    description: "Para el clima frío de Bogotá y la seguridad de la ruta.",
  });
  await addWishItem({
    title: "Impresora 3D Ender",
    link: "https://www.creality.com/",
    amount: 1_350_000,
    category: "Tecnología",
    description: "Para los llaveros y figuras del emprendimiento.",
  });
  await addWishItem({
    title: "Smartwatch deportivo",
    link: "https://www.amazfit.com/",
    amount: 420_000,
    category: "Tecnología",
    description: "Para medir el entrenamiento y las rutas en moto.",
  });
  await addWishItem({
    title: "Teclado mecánico",
    link: "https://www.logitech.com/co/",
    amount: 330_000,
    category: "Tecnología",
    description: "Para escribir el informe final y las tareas del módulo.",
  });
}

// ─── Punto de entrada ──────────────────────────────────────────────────────

// Limpia la base completa antes de sembrar: re-seedear nunca debe sumar
// datos sobre los anteriores (metas, recurrentes y movimientos viejos se
// mantendrían y duplicarían la información). Espera las materializaciones
// en vuelo para que el borrado no choque con "database is locked".
// El nombre de usuario NO se siembra: se captura antes del borrado (que
// limpia settings) y se restaura al final; si no había, queda "usuario".
export async function runDevSeed(kind: DevSeedKind): Promise<void> {
  const savedName = await getUserName();
  await flushMaterializeChain();
  await clearAllData();
  if (kind === "parttime") await seedPartTime();
  else if (kind === "supported") await seedSupported();
  else if (kind === "worker") await seedWorker();
  else if (kind === "fellowship") await seedFellowship();
  else await seedTechnical();
  await setUserName(savedName ?? "usuario");
}