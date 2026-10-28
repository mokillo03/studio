'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

// 1. Registrar ingreso: guarda Cliente, Equipo y Reparación de forma normalizada
export async function registrarIngreso(formData: FormData) {
  const clienteIdExistente = (formData.get('clienteId') as string)?.trim() || null
  const equipoIdExistente = (formData.get('equipoId') as string)?.trim() || null

  const nombre = (formData.get('nombre') as string)?.trim()
  const apellido = (formData.get('apellido') as string)?.trim()
  const telefono = (formData.get('telefono') as string)?.trim()
  const correo = (formData.get('correo') as string)?.trim() || null
  const dni = (formData.get('dni') as string)?.trim() || null

  const tipo = (formData.get('tipo') as string)?.trim() || null
  const marca = (formData.get('marca') as string)?.trim()
  const modelo = (formData.get('modelo') as string)?.trim()
  const numeroSerie = (formData.get('numeroSerie') as string)?.trim() || null

  const fallaCliente = (formData.get('fallaCliente') as string)?.trim()
  const diagnostico = (formData.get('diagnostico') as string)?.trim() || null
  const observaciones = (formData.get('observaciones') as string)?.trim() || null

  if (!nombre || !apellido || !telefono || !marca || !modelo || !fallaCliente) {
    throw new Error('Todos los campos obligatorios deben completarse.')
  }

  await prisma.$transaction(async (tx) => {
    // 1. Guardar o actualizar Cliente
    let clienteId = clienteIdExistente

    if (clienteId) {
      await tx.cliente.update({
        where: { id: clienteId },
        data: { nombre, apellido, telefono, correo, dni },
      })
    } else if (dni) {
      const clientePorDni = await tx.cliente.findFirst({
        where: { dni },
      })
      if (clientePorDni) {
        const actualizado = await tx.cliente.update({
          where: { id: clientePorDni.id },
          data: { nombre, apellido, telefono, correo },
        })
        clienteId = actualizado.id
      }
    }

    if (!clienteId) {
      const nuevoCliente = await tx.cliente.create({
        data: {
          nombre,
          apellido,
          telefono,
          correo,
          dni,
        },
      })
      clienteId = nuevoCliente.id
    }

    // 2. Guardar o actualizar Equipo vinculado al Cliente
    let equipoId = equipoIdExistente

    if (equipoId) {
      await tx.equipo.update({
        where: { id: equipoId },
        data: { tipo, marca, modelo, numeroSerie, clienteId },
      })
    } else if (numeroSerie) {
      const equipoPorSerie = await tx.equipo.findFirst({
        where: {
          clienteId,
          numeroSerie,
        },
      })
      if (equipoPorSerie) {
        const equipoActualizado = await tx.equipo.update({
          where: { id: equipoPorSerie.id },
          data: { tipo, marca, modelo },
        })
        equipoId = equipoActualizado.id
      }
    }

    if (!equipoId) {
      const nuevoEquipo = await tx.equipo.create({
        data: {
          tipo,
          marca,
          modelo,
          numeroSerie,
          clienteId,
        },
      })
      equipoId = nuevoEquipo.id
    }

    // 3. Crear la orden de Reparación vinculada al Equipo
    await tx.reparacion.create({
      data: {
        fallaCliente,
        diagnostico,
        observaciones,
        estado: 'PENDIENTE',
        equipoId,
      },
    })
  })

  revalidatePath('/')
}

// 2. Marcar como En Proceso (revisión técnica iniciada y diagnóstico preliminar)
export async function marcarEnProceso(reparacionId: string, diagnostico?: string) {
  await prisma.reparacion.update({
    where: { id: reparacionId },
    data: {
      estado: 'EN_PROCESO',
      ...(diagnostico !== undefined
        ? { diagnostico: diagnostico.trim() || null }
        : {}),
    },
  })

  revalidatePath('/')
}

// 3. Marcar como Por Entregar (fijar presupuesto acordado y diagnóstico técnico)
export async function marcarPorEntregar(
  reparacionId: string,
  presupuesto: number,
  diagnostico?: string
) {
  const montoValido =
    Number.isFinite(presupuesto) && presupuesto >= 0 ? presupuesto : 0

  await prisma.reparacion.update({
    where: { id: reparacionId },
    data: {
      estado: 'POR_ENTREGAR',
      presupuesto: montoValido,
      ...(diagnostico !== undefined
        ? { diagnostico: diagnostico.trim() || null }
        : {}),
    },
  })

  revalidatePath('/')
}

// 4. Entregar y Cobrar (cierra la orden, registra fecha de egreso y suma al balance)
export async function entregarEquipo(
  reparacionId: string,
  precioCobrado: number
) {
  const cobroValido =
    Number.isFinite(precioCobrado) && precioCobrado >= 0 ? precioCobrado : 0

  await prisma.reparacion.update({
    where: { id: reparacionId },
    data: {
      estado: 'ENTREGADO',
      precioCobrado: cobroValido,
      fechaSalida: new Date(),
    },
  })

  revalidatePath('/')
}

// 5. Cancelar reparación (rechazo de presupuesto o retiro sin reparación, registra fecha de egreso)
export async function cancelarReparacion(
  reparacionId: string,
  motivoCancelado: string
) {
  await prisma.reparacion.update({
    where: { id: reparacionId },
    data: {
      estado: 'CANCELADO',
      motivoCancelado: motivoCancelado.trim() || 'Sin especificar',
      precioCobrado: 0,
      fechaSalida: new Date(),
    },
  })

  revalidatePath('/')
}
