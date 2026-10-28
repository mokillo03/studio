'use client'

import { Suspense, useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { supabase } from '@/lib/supabase'
import {
  registrarIngreso,
  marcarEnProceso,
  marcarPorEntregar,
  entregarEquipo,
  cancelarReparacion,
} from '@/actions/equipos'
import {
  Wrench,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  PlusCircle,
  PlayCircle,
  RefreshCw,
  Calendar,
  Monitor,
  User,
  Hash,
  FileText,
  History,
  ArrowUpRight,
} from 'lucide-react'

type Cliente = {
  id: string
  nombre: string
  apellido: string
  telefono: string
  dni?: string | null
  correo?: string | null
}

type Equipo = {
  id: string
  tipo?: string | null
  marca: string
  modelo: string
  numeroSerie?: string | null
  clienteId: string
  cliente: Cliente
}

type Reparacion = {
  id: string
  fallaCliente: string
  diagnostico?: string | null
  observaciones?: string | null
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'POR_ENTREGAR' | 'ENTREGADO' | 'CANCELADO'
  presupuesto?: number | string | null
  precioCobrado?: number | string | null
  motivoCancelado?: string | null
  fechaIngreso: string
  fechaSalida?: string | null
  equipoId: string
  equipo: Equipo
}

const TIPOS_EQUIPO = [
  'Notebook',
  'PC de escritorio',
  'All in One',
  'Consola',
  'Monitor',
  'Impresora',
  'Otro',
]

const MOTIVOS_CANCELACION_RAPIDOS = [
  'No aceptó presupuesto',
  'Sin repuesto disponible',
  'Equipo irreparable',
  'Retirado por el cliente',
]

function formatearFecha(fechaIso?: string | null): string {
  if (!fechaIso) return '—'
  const fecha = new Date(fechaIso)
  if (Number.isNaN(fecha.getTime())) return '—'
  return fecha.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Dashboard() {
  const [reparaciones, setReparaciones] = useState<Reparacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [fechaActual, setFechaActual] = useState<Date | null>(null)
  const [notificacionError, setNotificacionError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Estado para el Modal de Recepción de Equipo
  const [mostrarModalIngreso, setMostrarModalIngreso] = useState(false)
  const [clienteSeleccionadoId, setClienteSeleccionadoId] = useState<string>('')
  const [equipoSeleccionadoId, setEquipoSeleccionadoId] = useState<string>('')
  const [formIngreso, setFormIngreso] = useState({
    nombre: '',
    apellido: '',
    telefono: '',
    dni: '',
    correo: '',
    tipo: 'Notebook',
    marca: '',
    modelo: '',
    numeroSerie: '',
    fallaCliente: '',
    diagnostico: '',
    observaciones: '',
  })
  const [errorModalIngreso, setErrorModalIngreso] = useState<string | null>(null)

  // Estado para el Modal de "En Proceso / Diagnóstico"
  const [modalEnProceso, setModalEnProceso] = useState<{
    reparacion: Reparacion
    diagnostico: string
  } | null>(null)

  // Estado para el Modal de "Pasar a Por Entregar (Presupuesto)"
  const [modalPorEntregar, setModalPorEntregar] = useState<{
    reparacion: Reparacion
    diagnostico: string
    presupuesto: string
    error: string | null
  } | null>(null)

  // Estado para el Modal de "Registrar Entrega y Cobro"
  const [modalEntrega, setModalEntrega] = useState<{
    reparacion: Reparacion
    precioCobrado: string
    error: string | null
  } | null>(null)

  // Estado para el Modal de "Cancelar Reparación"
  const [modalCancelar, setModalCancelar] = useState<{
    reparacion: Reparacion
    motivo: string
    error: string | null
  } | null>(null)

  // Estado para el Modal de Historial de Balances Mensuales
  const [mostrarModalBalances, setMostrarModalBalances] = useState(false)
  const [filtroMesHistorial, setFiltroMesHistorial] = useState<string>('todos')

  const cargarDatos = useCallback(async () => {
    try {
      const res = await fetch('/api/equipos', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error('No se pudieron obtener las reparaciones.')
      }
      const data = await res.json()
      setReparaciones(Array.isArray(data) ? data : [])
      setNotificacionError(null)
    } catch {
      setNotificacionError(
        'Error al conectar con el servidor para cargar las reparaciones.'
      )
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    let activo = true

    fetch('/api/equipos', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('No se pudieron obtener las reparaciones.')
        return res.json()
      })
      .then((data) => {
        if (!activo) return
        setReparaciones(Array.isArray(data) ? data : [])
        setFechaActual(new Date())
        setNotificacionError(null)
      })
      .catch(() => {
        if (!activo) return
        setNotificacionError(
          'Error al conectar con el servidor para cargar las reparaciones.'
        )
      })
      .finally(() => {
        if (activo) setCargando(false)
      })

    const client = supabase
    if (!client) {
      return () => {
        activo = false
      }
    }

    const canal = client
      .channel('cambios-taller')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reparaciones' },
        () => {
          cargarDatos()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'equipos' },
        () => {
          cargarDatos()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clientes' },
        () => {
          cargarDatos()
        }
      )
      .subscribe()

    return () => {
      activo = false
      client.removeChannel(canal)
    }
  }, [cargarDatos])

  // Clientes y equipos únicos registrados previamente para autocompletar en reingresos
  const clientesRegistrados = useMemo(() => {
    const mapa = new Map<string, Cliente>()
    for (const rep of reparaciones) {
      const cli = rep.equipo?.cliente
      if (cli && !mapa.has(cli.id)) {
        mapa.set(cli.id, cli)
      }
    }
    return Array.from(mapa.values())
  }, [reparaciones])

  const equiposDelClienteSeleccionado = useMemo(() => {
    if (!clienteSeleccionadoId) return []
    const mapa = new Map<string, Equipo>()
    for (const rep of reparaciones) {
      const eq = rep.equipo
      if (eq && eq.clienteId === clienteSeleccionadoId && !mapa.has(eq.id)) {
        mapa.set(eq.id, eq)
      }
    }
    return Array.from(mapa.values())
  }, [reparaciones, clienteSeleccionadoId])

  // Filtros por estado de reparación
  const pendientes = reparaciones.filter(
    (r) => r.estado === 'PENDIENTE' || r.estado === 'EN_PROCESO'
  )
  const porEntregar = reparaciones.filter((r) => r.estado === 'POR_ENTREGAR')
  const entregados = reparaciones.filter((r) => r.estado === 'ENTREGADO')
  const cancelados = reparaciones.filter((r) => r.estado === 'CANCELADO')
  const historial = reparaciones.filter(
    (r) => r.estado === 'ENTREGADO' || r.estado === 'CANCELADO'
  )

  // Balances mensuales calculados dinámicamente:
  // El 1 de cada mes el balance del mes actual se reinicia automáticamente a $0
  // y el mes cerrado queda registrado en el historial.
  const {
    balanceMesActual,
    balanceMesAnterior,
    nombreMesActual,
    nombreMesAnterior,
    totalHistorico,
    balancesPorMes,
    claveMesActual,
    claveMesAnterior,
  } = useMemo(() => {
    const ahora = fechaActual || new Date('2026-01-01T00:00:00Z')
    const mesActualIdx = ahora.getMonth()
    const anioActual = ahora.getFullYear()

    const fechaAnt = new Date(anioActual, mesActualIdx - 1, 1)
    const mesAntIdx = fechaAnt.getMonth()
    const anioAnt = fechaAnt.getFullYear()

    const claveAct = `${anioActual}-${String(mesActualIdx + 1).padStart(2, '0')}`
    const claveAnt = `${anioAnt}-${String(mesAntIdx + 1).padStart(2, '0')}`

    const mapa = new Map<
      string,
      { mes: number; anio: number; total: number; cantidad: number }
    >()

    // Asegurar que tanto el mes en curso como el mes anterior siempre existan en el mapa
    mapa.set(claveAct, {
      mes: mesActualIdx,
      anio: anioActual,
      total: 0,
      cantidad: 0,
    })
    mapa.set(claveAnt, {
      mes: mesAntIdx,
      anio: anioAnt,
      total: 0,
      cantidad: 0,
    })

    let acumulado = 0

    for (const rep of entregados) {
      const cobro = Number(rep.precioCobrado || 0)
      acumulado += cobro

      const fechaRef = rep.fechaSalida
        ? new Date(rep.fechaSalida)
        : new Date(rep.fechaIngreso)
      if (Number.isNaN(fechaRef.getTime())) continue

      const m = fechaRef.getMonth()
      const a = fechaRef.getFullYear()
      const clave = `${a}-${String(m + 1).padStart(2, '0')}`

      const actual = mapa.get(clave) || {
        mes: m,
        anio: a,
        total: 0,
        cantidad: 0,
      }
      actual.total += cobro
      actual.cantidad += 1
      mapa.set(clave, actual)
    }

    const lista = Array.from(mapa.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([clave, datos]) => {
        const d = new Date(datos.anio, datos.mes, 1)
        const nom = d.toLocaleString('es-AR', {
          month: 'long',
          year: 'numeric',
        })
        const nombre = nom.charAt(0).toUpperCase() + nom.slice(1)
        return {
          clave,
          mes: datos.mes,
          anio: datos.anio,
          nombre,
          total: datos.total,
          cantidad: datos.cantidad,
          esActual: clave === claveAct,
          esAnterior: clave === claveAnt,
        }
      })

    const actualItem = lista.find((item) => item.esActual)
    const anteriorItem = lista.find((item) => item.esAnterior)

    return {
      balanceMesActual: actualItem?.total || 0,
      balanceMesAnterior: anteriorItem?.total || 0,
      nombreMesActual: actualItem?.nombre || 'Mes actual',
      nombreMesAnterior: anteriorItem?.nombre || 'Mes anterior',
      totalHistorico: acumulado,
      balancesPorMes: lista,
      claveMesActual: claveAct,
      claveMesAnterior: claveAnt,
    }
  }, [entregados, fechaActual])

  // Filtrado de historial por mes
  const historialFiltrado = useMemo(() => {
    if (filtroMesHistorial === 'todos') return historial

    return historial.filter((rep) => {
      const fecha = rep.fechaSalida
        ? new Date(rep.fechaSalida)
        : new Date(rep.fechaIngreso)
      if (Number.isNaN(fecha.getTime())) return false

      const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
      if (filtroMesHistorial === 'actual') return clave === claveMesActual
      if (filtroMesHistorial === 'anterior') return clave === claveMesAnterior
      return clave === filtroMesHistorial
    })
  }, [historial, filtroMesHistorial, claveMesActual, claveMesAnterior])

  const ejecutarAccion = (
    accion: () => Promise<void>,
    onSuccess?: () => void
  ) => {
    startTransition(async () => {
      try {
        setNotificacionError(null)
        await accion()
        if (onSuccess) onSuccess()
        await cargarDatos()
      } catch {
        setNotificacionError('Ocurrió un error al procesar la operación.')
      }
    })
  }

  const abrirModalIngreso = () => {
    setClienteSeleccionadoId('')
    setEquipoSeleccionadoId('')
    setErrorModalIngreso(null)
    setFormIngreso({
      nombre: '',
      apellido: '',
      telefono: '',
      dni: '',
      correo: '',
      tipo: 'Notebook',
      marca: '',
      modelo: '',
      numeroSerie: '',
      fallaCliente: '',
      diagnostico: '',
      observaciones: '',
    })
    setMostrarModalIngreso(true)
  }

  const seleccionarClienteExistente = (id: string) => {
    setClienteSeleccionadoId(id)
    setEquipoSeleccionadoId('')
    if (!id) {
      setFormIngreso((prev) => ({
        ...prev,
        nombre: '',
        apellido: '',
        telefono: '',
        dni: '',
        correo: '',
        tipo: 'Notebook',
        marca: '',
        modelo: '',
        numeroSerie: '',
      }))
      return
    }
    const cli = clientesRegistrados.find((c) => c.id === id)
    if (cli) {
      setFormIngreso((prev) => ({
        ...prev,
        nombre: cli.nombre,
        apellido: cli.apellido,
        telefono: cli.telefono,
        dni: cli.dni || '',
        correo: cli.correo || '',
      }))
    }
  }

  const seleccionarEquipoExistente = (id: string) => {
    setEquipoSeleccionadoId(id)
    if (!id) {
      setFormIngreso((prev) => ({
        ...prev,
        tipo: 'Notebook',
        marca: '',
        modelo: '',
        numeroSerie: '',
      }))
      return
    }
    const eq = equiposDelClienteSeleccionado.find((e) => e.id === id)
    if (eq) {
      setFormIngreso((prev) => ({
        ...prev,
        tipo: eq.tipo || 'Notebook',
        marca: eq.marca,
        modelo: eq.modelo,
        numeroSerie: eq.numeroSerie || '',
      }))
    }
  }

  const parsearMonto = (texto: string): number | null => {
    const limpio = texto.trim().replace(/[^0-9.,-]/g, '').replace(',', '.')
    if (!limpio) return null
    const numero = parseFloat(limpio)
    if (Number.isNaN(numero) || numero < 0) return null
    return numero
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-10 text-slate-800">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Cabecera */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Control de Reparaciones
            </h1>
            <p className="text-slate-500 text-sm">
              Gestión normalizada de clientes, equipos, órdenes de reparación y
              balance de caja.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCargando(true)
                cargarDatos()
              }}
              disabled={cargando || isPending}
              title="Actualizar listado"
              className="flex items-center justify-center p-2.5 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={abrirModalIngreso}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors cursor-pointer"
            >
              <PlusCircle className="w-5 h-5" />
              Recibir Equipo
            </button>
          </div>
        </div>

        {/* Banner de notificación de error */}
        {notificacionError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between gap-4">
            <span>{notificacionError}</span>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={cargarDatos}
                className="text-xs font-semibold underline hover:text-red-800 cursor-pointer"
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={() => setNotificacionError(null)}
                className="text-red-500 hover:text-red-700 font-bold text-base leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Tarjetas de Métricas y Balance */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                En Taller
              </p>
              <h2 className="text-2xl font-bold text-amber-600 mt-1">
                {pendientes.length}
              </h2>
            </div>
            <Clock className="w-8 h-8 text-amber-500 opacity-80" />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                Por Entregar
              </p>
              <h2 className="text-2xl font-bold text-blue-600 mt-1">
                {porEntregar.length}
              </h2>
            </div>
            <Wrench className="w-8 h-8 text-blue-500 opacity-80" />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                Entregados
              </p>
              <h2 className="text-2xl font-bold text-emerald-600 mt-1">
                {entregados.length}
              </h2>
            </div>
            <CheckCircle className="w-8 h-8 text-emerald-500 opacity-80" />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                    Balance del Mes
                  </p>
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded border border-emerald-200">
                    {nombreMesActual}
                  </span>
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mt-1">
                  ${balanceMesActual.toLocaleString('es-AR')}
                </h2>
              </div>
              <DollarSign className="w-8 h-8 text-emerald-600 opacity-80 shrink-0" />
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                Mes anterior: <strong className="text-slate-700 font-bold">${balanceMesAnterior.toLocaleString('es-AR')}</strong>
              </span>
              <button
                type="button"
                onClick={() => setMostrarModalBalances(true)}
                className="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-0.5 cursor-pointer text-[11px]"
              >
                Historial <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Columnas Principales de Trabajo */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Columna 1: Pendientes y En Proceso */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Equipos en Revisión / Reparación ({pendientes.length})
            </h3>
            <div className="space-y-4">
              {cargando ? (
                <p className="text-slate-400 text-sm italic">
                  Cargando órdenes de reparación...
                </p>
              ) : pendientes.length === 0 ? (
                <p className="text-slate-400 text-sm italic">
                  No hay equipos pendientes de revisión.
                </p>
              ) : (
                pendientes.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2.5 text-sm"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {rep.equipo.tipo && (
                            <span className="text-[11px] bg-slate-200 text-slate-700 font-medium px-2 py-0.5 rounded">
                              {rep.equipo.tipo}
                            </span>
                          )}
                          <h4 className="font-bold text-slate-900">
                            {rep.equipo.marca} {rep.equipo.modelo}
                          </h4>
                          {rep.equipo.numeroSerie && (
                            <span className="text-xs text-slate-500 font-mono flex items-center gap-0.5">
                              <Hash className="w-3 h-3" />
                              {rep.equipo.numeroSerie}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="inline-flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400" />
                            {rep.equipo.cliente.nombre}{' '}
                            {rep.equipo.cliente.apellido}
                          </span>
                          <span>• Tel: {rep.equipo.cliente.telefono}</span>
                          {rep.equipo.cliente.dni && (
                            <span>• DNI: {rep.equipo.cliente.dni}</span>
                          )}
                        </p>
                      </div>
                      {rep.estado === 'EN_PROCESO' ? (
                        <span className="text-xs bg-indigo-100 text-indigo-800 font-semibold px-2.5 py-0.5 rounded shrink-0">
                          En Proceso
                        </span>
                      ) : (
                        <span className="text-xs bg-amber-100 text-amber-800 font-semibold px-2.5 py-0.5 rounded shrink-0">
                          Pendiente
                        </span>
                      )}
                    </div>

                    {/* Fechas */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <strong>Ingreso:</strong> {formatearFecha(rep.fechaIngreso)}
                      </span>
                    </div>

                    {/* Falla, Diagnóstico y Observaciones */}
                    <div className="bg-white p-2.5 rounded border border-slate-100 text-xs space-y-1">
                      <p>
                        <strong className="text-slate-700">
                          Falla reportada:
                        </strong>{' '}
                        {rep.fallaCliente}
                      </p>
                      {rep.diagnostico && (
                        <p className="text-indigo-700">
                          <strong>Diagnóstico técnico:</strong> {rep.diagnostico}
                        </p>
                      )}
                      {rep.observaciones && (
                        <p className="text-slate-500">
                          <strong>Accesorios / Obs:</strong> {rep.observaciones}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1 justify-end">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          setModalCancelar({
                            reparacion: rep,
                            motivo: '',
                            error: null,
                          })
                        }
                        className="text-xs text-red-600 hover:text-red-700 font-medium px-3 py-1.5 border border-red-200 rounded hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Cancelar Reparación
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          setModalEnProceso({
                            reparacion: rep,
                            diagnostico: rep.diagnostico || '',
                          })
                        }
                        className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium px-3 py-1.5 rounded hover:bg-indigo-100 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        {rep.estado === 'EN_PROCESO'
                          ? 'Editar Diagnóstico'
                          : 'Pasar a En Proceso'}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          setModalPorEntregar({
                            reparacion: rep,
                            diagnostico: rep.diagnostico || '',
                            presupuesto:
                              rep.presupuesto != null
                                ? String(rep.presupuesto)
                                : '',
                            error: null,
                          })
                        }
                        className="text-xs bg-blue-600 text-white font-medium px-3 py-1.5 rounded hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Pasar a Por Entregar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Columna 2: Por Entregar */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              Equipos Listos para Entrega ({porEntregar.length})
            </h3>
            <div className="space-y-4">
              {cargando ? (
                <p className="text-slate-400 text-sm italic">
                  Cargando órdenes de reparación...
                </p>
              ) : porEntregar.length === 0 ? (
                <p className="text-slate-400 text-sm italic">
                  No hay equipos listos para retirar.
                </p>
              ) : (
                porEntregar.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-4 rounded-lg border border-blue-200 bg-blue-50/20 space-y-2.5 text-sm"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {rep.equipo.tipo && (
                            <span className="text-[11px] bg-blue-100 text-blue-800 font-medium px-2 py-0.5 rounded">
                              {rep.equipo.tipo}
                            </span>
                          )}
                          <h4 className="font-bold text-slate-900">
                            {rep.equipo.marca} {rep.equipo.modelo}
                          </h4>
                          {rep.equipo.numeroSerie && (
                            <span className="text-xs text-slate-500 font-mono flex items-center gap-0.5">
                              <Hash className="w-3 h-3" />
                              {rep.equipo.numeroSerie}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="inline-flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400" />
                            {rep.equipo.cliente.nombre}{' '}
                            {rep.equipo.cliente.apellido}
                          </span>
                          <span>• Tel: {rep.equipo.cliente.telefono}</span>
                          {rep.equipo.cliente.dni && (
                            <span>• DNI: {rep.equipo.cliente.dni}</span>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs bg-blue-100 text-blue-800 font-semibold px-2.5 py-0.5 rounded">
                          Por Entregar
                        </span>
                        <p className="text-sm font-bold text-emerald-700 mt-1">
                          A Cobrar: $
                          {Number(rep.presupuesto || 0).toLocaleString('es-AR')}
                        </p>
                      </div>
                    </div>

                    {/* Fechas */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <strong>Ingreso:</strong> {formatearFecha(rep.fechaIngreso)}
                      </span>
                    </div>

                    {/* Falla, Diagnóstico y Observaciones */}
                    <div className="bg-white p-2.5 rounded border border-slate-100 text-xs space-y-1">
                      <p>
                        <strong className="text-slate-700">
                          Falla reportada:
                        </strong>{' '}
                        {rep.fallaCliente}
                      </p>
                      {rep.diagnostico && (
                        <p className="text-blue-800">
                          <strong>Diagnóstico / Trabajo:</strong>{' '}
                          {rep.diagnostico}
                        </p>
                      )}
                      {rep.observaciones && (
                        <p className="text-slate-500">
                          <strong>Accesorios / Obs:</strong> {rep.observaciones}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1 justify-end">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          setModalCancelar({
                            reparacion: rep,
                            motivo: '',
                            error: null,
                          })
                        }
                        className="text-xs text-red-600 hover:text-red-700 font-medium px-3 py-1.5 border border-red-200 rounded hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          setModalEntrega({
                            reparacion: rep,
                            precioCobrado:
                              rep.presupuesto != null
                                ? String(rep.presupuesto)
                                : '0',
                            error: null,
                          })
                        }
                        className="text-xs bg-emerald-600 text-white font-medium px-3 py-1.5 rounded hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Registrar Entrega y Cobro
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Historial de Equipos Entregados y Cancelados con Fechas de Ingreso y Egreso */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-500" />
                Historial de Ingresos y Egresos ({historial.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Seguimiento de salidas, cierres mensuales y balances recaudados.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setMostrarModalBalances(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
              >
                <History className="w-3.5 h-3.5 text-blue-600" />
                Historial de Balances
              </button>
              <div className="flex items-center gap-3 text-xs text-slate-500 pl-1">
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  {entregados.length} entregados
                </span>
                <span className="flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                  {cancelados.length} cancelados
                </span>
              </div>
            </div>
          </div>

          {/* Banner Resumen de Balances Mensuales */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50/80 border border-slate-200 rounded-xl p-3 text-xs">
            <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-200/80 shadow-xs">
              <div>
                <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Balance Mes Actual ({nombreMesActual})
                </p>
                <p className="text-base font-bold text-slate-900 mt-0.5">
                  ${balanceMesActual.toLocaleString('es-AR')}
                </p>
              </div>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded">
                En curso
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-200/80 shadow-xs">
              <div>
                <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Balance Mes Anterior ({nombreMesAnterior})
                </p>
                <p className="text-base font-bold text-slate-900 mt-0.5">
                  ${balanceMesAnterior.toLocaleString('es-AR')}
                </p>
              </div>
              <span className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded">
                Cerrado
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-200/80 shadow-xs">
              <div>
                <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Total Histórico Acumulado
                </p>
                <p className="text-base font-bold text-slate-900 mt-0.5">
                  ${totalHistorico.toLocaleString('es-AR')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalBalances(true)}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold underline cursor-pointer"
              >
                Ver todos
              </button>
            </div>
          </div>

          {/* Filtros rápidos por período */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100 text-xs">
            <span className="text-slate-400 font-semibold mr-1">Filtrar:</span>
            <button
              type="button"
              onClick={() => setFiltroMesHistorial('todos')}
              className={`px-2.5 py-1 rounded-lg border font-medium transition-colors cursor-pointer ${
                filtroMesHistorial === 'todos'
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Todos ({historial.length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroMesHistorial('actual')}
              className={`px-2.5 py-1 rounded-lg border font-medium transition-colors cursor-pointer ${
                filtroMesHistorial === 'actual'
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Mes Actual: {nombreMesActual}
            </button>
            <button
              type="button"
              onClick={() => setFiltroMesHistorial('anterior')}
              className={`px-2.5 py-1 rounded-lg border font-medium transition-colors cursor-pointer ${
                filtroMesHistorial === 'anterior'
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Mes Anterior: {nombreMesAnterior}
            </button>
          </div>

          {historialFiltrado.length === 0 ? (
            <p className="text-slate-400 text-sm italic py-4">
              No hay registros en el período seleccionado.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {historialFiltrado.map((rep) => (
                <div
                  key={rep.id}
                  className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 text-xs space-y-2 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {rep.equipo.tipo && (
                            <span className="text-[10px] bg-slate-200 text-slate-700 font-medium px-1.5 py-0.5 rounded">
                              {rep.equipo.tipo}
                            </span>
                          )}
                          <p className="font-bold text-slate-900 text-sm">
                            {rep.equipo.marca} {rep.equipo.modelo}
                          </p>
                        </div>
                        <p className="text-slate-500 mt-0.5">
                          Cliente: {rep.equipo.cliente.nombre}{' '}
                          {rep.equipo.cliente.apellido} •{' '}
                          {rep.equipo.cliente.telefono}
                        </p>
                        {rep.equipo.numeroSerie && (
                          <p className="text-slate-400 font-mono">
                            S/N: {rep.equipo.numeroSerie}
                          </p>
                        )}
                      </div>
                      {rep.estado === 'ENTREGADO' ? (
                        <span className="bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded shrink-0">
                          Entregado
                        </span>
                      ) : (
                        <span className="bg-red-100 text-red-800 font-semibold px-2 py-0.5 rounded shrink-0">
                          Cancelado
                        </span>
                      )}
                    </div>

                    <div className="bg-white p-2 rounded border border-slate-100 space-y-1">
                      <p>
                        <strong className="text-slate-700">Falla:</strong>{' '}
                        {rep.fallaCliente}
                      </p>
                      {rep.diagnostico && (
                        <p className="text-slate-600">
                          <strong>Diagnóstico:</strong> {rep.diagnostico}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                    <div className="text-slate-500 space-y-0.5">
                      <p className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        <strong>Ingreso:</strong>{' '}
                        {formatearFecha(rep.fechaIngreso)}
                      </p>
                      <p className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        <strong>Egreso:</strong>{' '}
                        {formatearFecha(rep.fechaSalida)}
                      </p>
                    </div>

                    {rep.estado === 'ENTREGADO' ? (
                      <p className="font-bold text-emerald-700 text-sm">
                        Cobrado: $
                        {Number(rep.precioCobrado || 0).toLocaleString('es-AR')}
                      </p>
                    ) : (
                      <p className="text-red-600 font-medium">
                        Motivo: {rep.motivoCancelado || 'Sin especificar'}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* =====================================================================
          VENTANA EMERGENTE 1: RECEPCIÓN DE EQUIPO (Cliente + Equipo + Reparación)
      ===================================================================== */}
      {mostrarModalIngreso && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Recepción de Equipo
                </h3>
                <p className="text-xs text-slate-500">
                  Registra los datos del cliente, el equipo y la orden de
                  reparación.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalIngreso(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            {errorModalIngreso && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                {errorModalIngreso}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (
                  !formIngreso.nombre.trim() ||
                  !formIngreso.apellido.trim() ||
                  !formIngreso.telefono.trim() ||
                  !formIngreso.marca.trim() ||
                  !formIngreso.modelo.trim() ||
                  !formIngreso.fallaCliente.trim()
                ) {
                  setErrorModalIngreso(
                    'Por favor completá todos los campos obligatorios (*).'
                  )
                  return
                }

                const fd = new FormData()
                if (clienteSeleccionadoId) {
                  fd.set('clienteId', clienteSeleccionadoId)
                }
                if (equipoSeleccionadoId) {
                  fd.set('equipoId', equipoSeleccionadoId)
                }
                fd.set('nombre', formIngreso.nombre)
                fd.set('apellido', formIngreso.apellido)
                fd.set('telefono', formIngreso.telefono)
                fd.set('dni', formIngreso.dni)
                fd.set('correo', formIngreso.correo)
                fd.set('tipo', formIngreso.tipo)
                fd.set('marca', formIngreso.marca)
                fd.set('modelo', formIngreso.modelo)
                fd.set('numeroSerie', formIngreso.numeroSerie)
                fd.set('fallaCliente', formIngreso.fallaCliente)
                fd.set('diagnostico', formIngreso.diagnostico)
                fd.set('observaciones', formIngreso.observaciones)

                ejecutarAccion(
                  () => registrarIngreso(fd),
                  () => setMostrarModalIngreso(false)
                )
              }}
              className="space-y-5 text-sm"
            >
              {/* Sección 1: Datos del Cliente */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-blue-600" />
                    1. Datos del Cliente
                  </h4>
                  {clientesRegistrados.length > 0 && (
                    <select
                      value={clienteSeleccionadoId}
                      onChange={(e) =>
                        seleccionarClienteExistente(e.target.value)
                      }
                      className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">+ Nuevo cliente</option>
                      {clientesRegistrados.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre} {c.apellido} ({c.telefono}
                          {c.dni ? ` • DNI ${c.dni}` : ''})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Nombre *
                    </label>
                    <input
                      required
                      value={formIngreso.nombre}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          nombre: e.target.value,
                        })
                      }
                      type="text"
                      placeholder="Ej: Juan"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Apellido *
                    </label>
                    <input
                      required
                      value={formIngreso.apellido}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          apellido: e.target.value,
                        })
                      }
                      type="text"
                      placeholder="Ej: Pérez"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Teléfono *
                    </label>
                    <input
                      required
                      value={formIngreso.telefono}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          telefono: e.target.value,
                        })
                      }
                      type="tel"
                      placeholder="Ej: 11 2345-6789"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      DNI (Opcional)
                    </label>
                    <input
                      value={formIngreso.dni}
                      onChange={(e) =>
                        setFormIngreso({ ...formIngreso, dni: e.target.value })
                      }
                      type="text"
                      placeholder="Sin puntos"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Correo (Opcional)
                    </label>
                    <input
                      value={formIngreso.correo}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          correo: e.target.value,
                        })
                      }
                      type="email"
                      placeholder="cliente@correo.com"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Sección 2: Datos del Equipo */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5 text-blue-600" />
                    2. Datos del Equipo
                  </h4>
                  {equiposDelClienteSeleccionado.length > 0 && (
                    <select
                      value={equipoSeleccionadoId}
                      onChange={(e) =>
                        seleccionarEquipoExistente(e.target.value)
                      }
                      className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">+ Nuevo equipo de este cliente</option>
                      {equiposDelClienteSeleccionado.map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.tipo ? `${eq.tipo}: ` : ''}
                          {eq.marca} {eq.modelo}
                          {eq.numeroSerie ? ` (S/N: ${eq.numeroSerie})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Tipo de Equipo
                    </label>
                    <select
                      value={formIngreso.tipo}
                      onChange={(e) =>
                        setFormIngreso({ ...formIngreso, tipo: e.target.value })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {TIPOS_EQUIPO.map((tipo) => (
                        <option key={tipo} value={tipo}>
                          {tipo}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Número de Serie (Opcional)
                    </label>
                    <input
                      value={formIngreso.numeroSerie}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          numeroSerie: e.target.value,
                        })
                      }
                      placeholder="Ej: PF2X98A1"
                      type="text"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Marca *
                    </label>
                    <input
                      required
                      value={formIngreso.marca}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          marca: e.target.value,
                        })
                      }
                      placeholder="Lenovo, Asus, HP, Dell..."
                      type="text"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Modelo *
                    </label>
                    <input
                      required
                      value={formIngreso.modelo}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          modelo: e.target.value,
                        })
                      }
                      placeholder="ThinkPad E14, Pavilion 15..."
                      type="text"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Sección 3: Orden de Reparación */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-blue-600" />
                  3. Detalles de la Reparación
                </h4>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Falla Reportada por el Cliente *
                  </label>
                  <textarea
                    required
                    value={formIngreso.fallaCliente}
                    onChange={(e) =>
                      setFormIngreso({
                        ...formIngreso,
                        fallaCliente: e.target.value,
                      })
                    }
                    rows={2}
                    placeholder="No enciende, no da video, bisagra rota, lentitud..."
                    className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Accesorios / Observaciones
                    </label>
                    <input
                      value={formIngreso.observaciones}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          observaciones: e.target.value,
                        })
                      }
                      placeholder="Con cargador original, funda, rayón en tapa..."
                      type="text"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Diagnóstico Inicial (Opcional)
                    </label>
                    <input
                      value={formIngreso.diagnostico}
                      onChange={(e) =>
                        setFormIngreso({
                          ...formIngreso,
                          diagnostico: e.target.value,
                        })
                      }
                      placeholder="A verificar en banco de trabajo..."
                      type="text"
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setMostrarModalIngreso(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium cursor-pointer disabled:opacity-50"
                >
                  {isPending ? 'Guardando...' : 'Guardar Ingreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          VENTANA EMERGENTE 2: EN PROCESO / DIAGNÓSTICO TÉCNICO
      ===================================================================== */}
      {modalEnProceso && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Revisión y Diagnóstico Técnico
                </h3>
                <p className="text-xs text-slate-500">
                  {modalEnProceso.reparacion.equipo.marca}{' '}
                  {modalEnProceso.reparacion.equipo.modelo} • Cliente:{' '}
                  {modalEnProceso.reparacion.equipo.cliente.nombre}{' '}
                  {modalEnProceso.reparacion.equipo.cliente.apellido}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalEnProceso(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                const id = modalEnProceso.reparacion.id
                const diag = modalEnProceso.diagnostico
                ejecutarAccion(
                  () => marcarEnProceso(id, diag),
                  () => setModalEnProceso(null)
                )
              }}
              className="space-y-4 text-sm"
            >
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                <p>
                  <strong>Falla reportada:</strong>{' '}
                  {modalEnProceso.reparacion.fallaCliente}
                </p>
                <p className="text-slate-500">
                  <strong>Fecha de ingreso:</strong>{' '}
                  {formatearFecha(modalEnProceso.reparacion.fechaIngreso)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Diagnóstico Técnico / Avance de Revisión
                </label>
                <textarea
                  rows={3}
                  value={modalEnProceso.diagnostico}
                  onChange={(e) =>
                    setModalEnProceso({
                      ...modalEnProceso,
                      diagnostico: e.target.value,
                    })
                  }
                  placeholder="Describí qué se detectó en la revisión técnica (ej: Falla en disco SSD, requiere cambio y reinstalación de SO)..."
                  className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalEnProceso(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium cursor-pointer disabled:opacity-50"
                >
                  {isPending ? 'Guardando...' : 'Guardar en Proceso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          VENTANA EMERGENTE 3: PASAR A POR ENTREGAR (Presupuesto y Diagnóstico)
      ===================================================================== */}
      {modalPorEntregar && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Listo para Entregar y Presupuesto
                </h3>
                <p className="text-xs text-slate-500">
                  {modalPorEntregar.reparacion.equipo.marca}{' '}
                  {modalPorEntregar.reparacion.equipo.modelo} • Cliente:{' '}
                  {modalPorEntregar.reparacion.equipo.cliente.nombre}{' '}
                  {modalPorEntregar.reparacion.equipo.cliente.apellido}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalPorEntregar(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            {modalPorEntregar.error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                {modalPorEntregar.error}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                const monto = parsearMonto(modalPorEntregar.presupuesto)
                if (monto === null) {
                  setModalPorEntregar({
                    ...modalPorEntregar,
                    error: 'Por favor ingresá un monto presupuestado válido.',
                  })
                  return
                }
                const id = modalPorEntregar.reparacion.id
                const diag = modalPorEntregar.diagnostico
                ejecutarAccion(
                  () => marcarPorEntregar(id, monto, diag),
                  () => setModalPorEntregar(null)
                )
              }}
              className="space-y-4 text-sm"
            >
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                <p>
                  <strong>Falla reportada:</strong>{' '}
                  {modalPorEntregar.reparacion.fallaCliente}
                </p>
                <p className="text-slate-500">
                  <strong>Fecha de ingreso:</strong>{' '}
                  {formatearFecha(modalPorEntregar.reparacion.fechaIngreso)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Diagnóstico Técnico / Reparación Realizada
                </label>
                <textarea
                  rows={2}
                  value={modalPorEntregar.diagnostico}
                  onChange={(e) =>
                    setModalPorEntregar({
                      ...modalPorEntregar,
                      diagnostico: e.target.value,
                    })
                  }
                  placeholder="Detalle del trabajo realizado o diagnóstico final..."
                  className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Monto Presupuestado ($) *
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={modalPorEntregar.presupuesto}
                  onChange={(e) =>
                    setModalPorEntregar({
                      ...modalPorEntregar,
                      presupuesto: e.target.value,
                      error: null,
                    })
                  }
                  placeholder="Ej: 45000"
                  className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalPorEntregar(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium cursor-pointer disabled:opacity-50"
                >
                  {isPending ? 'Guardando...' : 'Pasar a Por Entregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          VENTANA EMERGENTE 4: REGISTRAR ENTREGA Y COBRO
      ===================================================================== */}
      {modalEntrega && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Registrar Entrega y Cobro
                </h3>
                <p className="text-xs text-slate-500">
                  {modalEntrega.reparacion.equipo.marca}{' '}
                  {modalEntrega.reparacion.equipo.modelo} • Cliente:{' '}
                  {modalEntrega.reparacion.equipo.cliente.nombre}{' '}
                  {modalEntrega.reparacion.equipo.cliente.apellido}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalEntrega(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            {modalEntrega.error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                {modalEntrega.error}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                const cobro = parsearMonto(modalEntrega.precioCobrado)
                if (cobro === null) {
                  setModalEntrega({
                    ...modalEntrega,
                    error: 'Por favor ingresá un monto final cobrado válido.',
                  })
                  return
                }
                const id = modalEntrega.reparacion.id
                ejecutarAccion(
                  () => entregarEquipo(id, cobro),
                  () => setModalEntrega(null)
                )
              }}
              className="space-y-4 text-sm"
            >
              <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-3 text-xs space-y-1">
                <p>
                  <strong>Falla:</strong> {modalEntrega.reparacion.fallaCliente}
                </p>
                {modalEntrega.reparacion.diagnostico && (
                  <p>
                    <strong>Diagnóstico / Trabajo:</strong>{' '}
                    {modalEntrega.reparacion.diagnostico}
                  </p>
                )}
                <p>
                  <strong>Presupuesto acordado:</strong> $
                  {Number(modalEntrega.reparacion.presupuesto || 0).toLocaleString(
                    'es-AR'
                  )}
                </p>
                <p className="text-slate-500">
                  <strong>Fecha de ingreso:</strong>{' '}
                  {formatearFecha(modalEntrega.reparacion.fechaIngreso)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Monto Final Cobrado ($) *
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={modalEntrega.precioCobrado}
                  onChange={(e) =>
                    setModalEntrega({
                      ...modalEntrega,
                      precioCobrado: e.target.value,
                      error: null,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Al confirmar se registrará automáticamente la fecha y hora de
                  egreso y se sumará al balance.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalEntrega(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium cursor-pointer disabled:opacity-50"
                >
                  {isPending
                    ? 'Registrando...'
                    : 'Confirmar Entrega y Cobro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          VENTANA EMERGENTE 5: CANCELAR REPARACIÓN
      ===================================================================== */}
      {modalCancelar && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Cancelar Reparación
                </h3>
                <p className="text-xs text-slate-500">
                  {modalCancelar.reparacion.equipo.marca}{' '}
                  {modalCancelar.reparacion.equipo.modelo} • Cliente:{' '}
                  {modalCancelar.reparacion.equipo.cliente.nombre}{' '}
                  {modalCancelar.reparacion.equipo.cliente.apellido}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalCancelar(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            {modalCancelar.error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                {modalCancelar.error}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!modalCancelar.motivo.trim()) {
                  setModalCancelar({
                    ...modalCancelar,
                    error: 'Por favor indicá el motivo de la cancelación.',
                  })
                  return
                }
                const id = modalCancelar.reparacion.id
                const motivo = modalCancelar.motivo.trim()
                ejecutarAccion(
                  () => cancelarReparacion(id, motivo),
                  () => setModalCancelar(null)
                )
              }}
              className="space-y-4 text-sm"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">
                  Motivos frecuentes (clic para seleccionar)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {MOTIVOS_CANCELACION_RAPIDOS.map((motivoRapido) => (
                    <button
                      key={motivoRapido}
                      type="button"
                      onClick={() =>
                        setModalCancelar({
                          ...modalCancelar,
                          motivo: motivoRapido,
                          error: null,
                        })
                      }
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                        modalCancelar.motivo === motivoRapido
                          ? 'bg-red-100 border-red-300 text-red-800 font-semibold'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {motivoRapido}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Motivo de Cancelación *
                </label>
                <textarea
                  required
                  rows={2}
                  value={modalCancelar.motivo}
                  onChange={(e) =>
                    setModalCancelar({
                      ...modalCancelar,
                      motivo: e.target.value,
                      error: null,
                    })
                  }
                  placeholder="Especificá el motivo de la cancelación..."
                  className="w-full border border-slate-300 rounded-lg p-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Se registrará la fecha y hora de egreso con cobro $0.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalCancelar(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-100 font-medium cursor-pointer"
                >
                  Volver
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium cursor-pointer disabled:opacity-50"
                >
                  {isPending ? 'Cancelando...' : 'Confirmar Cancelación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          VENTANA EMERGENTE 6: HISTORIAL DE BALANCES MENSUALES
      ===================================================================== */}
      {mostrarModalBalances && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-600" />
                  Historial de Balances Mensuales
                </h3>
                <p className="text-xs text-slate-500">
                  Cierres de mes y recaudación histórica de la caja del taller.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMostrarModalBalances(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="bg-blue-50/70 border border-blue-200 text-blue-800 rounded-lg p-3 text-xs leading-relaxed">
              💡 <strong>Cierre automático de caja:</strong> El día 1 de cada mes el balance en pantalla se reinicia a <strong>$0</strong> automáticamente, y el saldo final acumulado del mes anterior queda registrado en este historial.
            </div>

            {/* Listado de balances por mes */}
            <div className="space-y-2.5">
              {balancesPorMes.map((b) => (
                <div
                  key={b.clave}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    b.esActual
                      ? 'border-blue-300 bg-blue-50/30 shadow-xs'
                      : b.esAnterior
                      ? 'border-emerald-300 bg-emerald-50/20 shadow-xs'
                      : 'border-slate-200 bg-slate-50/50'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-slate-900 text-sm">
                        {b.nombre}
                      </h4>
                      {b.esActual ? (
                        <span className="text-[10px] bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded">
                          Mes actual (En curso)
                        </span>
                      ) : b.esAnterior ? (
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded">
                          Mes anterior (Cerrado)
                        </span>
                      ) : (
                        <span className="text-[10px] bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded">
                          Mes cerrado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {b.cantidad} {b.cantidad === 1 ? 'reparación entregada' : 'reparaciones entregadas'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/60">
                    <div className="text-right">
                      <p className="text-xs text-slate-400 font-medium">Recaudado</p>
                      <p className={`text-base font-bold ${b.esActual ? 'text-blue-700' : 'text-slate-900'}`}>
                        ${b.total.toLocaleString('es-AR')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (b.esActual) setFiltroMesHistorial('actual')
                        else if (b.esAnterior) setFiltroMesHistorial('anterior')
                        else setFiltroMesHistorial(b.clave)
                        setMostrarModalBalances(false)
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2.5 py-1.5 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer shrink-0"
                    >
                      Ver órdenes
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Total acumulado histórico */}
            <div className="p-3.5 bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">Total Histórico de Todos los Tiempos</span>
              <span className="text-base font-bold text-slate-900">
                ${totalHistorico.toLocaleString('es-AR')}
              </span>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setMostrarModalBalances(false)}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 text-xs font-semibold cursor-pointer transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
          Cargando sistema de reparaciones...
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  )
}
