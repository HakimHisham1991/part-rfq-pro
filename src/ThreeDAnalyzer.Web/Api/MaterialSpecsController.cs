using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;

namespace ThreeDAnalyzer.Web.Api;

[ApiController]
[Route("api/material-specs")]
public class MaterialSpecsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<MaterialSpecDto>>> List()
    {
        var items = await db.MaterialSpecs.OrderBy(m => m.Specification).ToListAsync();
        return items.Select(m => m.ToDto()).ToList();
    }
}
