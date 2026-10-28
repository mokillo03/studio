import { NextResponse, connection } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  await connection()
  try {
    const reparaciones = await prisma.reparacion.findMany({
      include: {
        equipo: {
          include: {
            cliente: true,
          },
        },
      },
      orderBy: {
        fechaIngreso: 'desc',
      },
    })
    return NextResponse.json(reparaciones)
  } catch {
    return NextResponse.json(
      { error: 'Error al consultar las reparaciones' },
      { status: 500 }
    )
  }
}
